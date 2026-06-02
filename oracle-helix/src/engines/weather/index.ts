// Weather Intelligence Engine — Open-Meteo (100% free, no API key)
import { WEATHER_THRESHOLDS } from '../../lib/constants.js'
import type { WeatherData } from '../../types/index.js'

const BASE = process.env.WEATHER_API_BASE || 'https://api.open-meteo.com/v1'

interface WeatherApiResponse {
  hourly: {
    time: string[]
    temperature_2m: number[]
    relative_humidity_2m: number[]
    wind_speed_10m: number[]
    wind_direction_10m: number[]
    wind_gusts_10m: number[]
    precipitation_probability: number[]
    precipitation: number[]
    cloud_cover: number[]
    weather_code: number[]
    dew_point_2m: number[]
  }
}

export async function fetchGameWeather(params: {
  latitude: number
  longitude: number
  gameTime: string
}): Promise<Partial<WeatherData>> {
  const url = new URL(`${BASE}/forecast`)
  url.searchParams.set('latitude', params.latitude.toString())
  url.searchParams.set('longitude', params.longitude.toString())
  url.searchParams.set('hourly', [
    'temperature_2m',
    'relative_humidity_2m',
    'wind_speed_10m',
    'wind_direction_10m',
    'wind_gusts_10m',
    'precipitation_probability',
    'precipitation',
    'cloud_cover',
    'weather_code',
    'dew_point_2m',
  ].join(','))
  url.searchParams.set('temperature_unit', 'fahrenheit')
  url.searchParams.set('wind_speed_unit', 'mph')
  url.searchParams.set('precipitation_unit', 'inch')
  url.searchParams.set('timezone', 'auto')
  url.searchParams.set('forecast_days', '3')

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`Weather API error: ${res.status}`)
  const data = await res.json() as WeatherApiResponse

  const gameHourIndex = findClosestHourIndex(data.hourly.time, params.gameTime)
  if (gameHourIndex === -1) throw new Error('Could not find weather hour for game time')

  const h = data.hourly
  const temp = h.temperature_2m[gameHourIndex]
  const humidity = h.relative_humidity_2m[gameHourIndex]
  const windSpeed = h.wind_speed_10m[gameHourIndex]
  const windDir = degreesToCardinal(h.wind_direction_10m[gameHourIndex])
  const windGust = h.wind_gusts_10m[gameHourIndex]
  const precipChance = h.precipitation_probability[gameHourIndex]
  const precip = h.precipitation[gameHourIndex]
  const cloudCover = h.cloud_cover[gameHourIndex]
  const dewPoint = h.dew_point_2m[gameHourIndex]
  const condition = wmoCodeToCondition(h.weather_code[gameHourIndex])

  const impactScore = calculateImpactScore({ temp, windSpeed, precipChance, precip, humidity })
  const impactSummary = generateImpactSummary({ temp, windSpeed, windDir, precipChance, condition, impactScore })

  return {
    forecastTime: params.gameTime,
    temperatureF: temp,
    humidity,
    windSpeedMph: windSpeed,
    windDirection: windDir,
    windGustMph: windGust,
    precipitationIn: precip,
    precipChance,
    cloud_cover_pct: cloudCover,
    condition,
    dew_point_f: dewPoint,
    impactScore,
    impactSummary,
  }
}

function findClosestHourIndex(times: string[], target: string): number {
  const targetMs = new Date(target).getTime()
  let closest = -1
  let minDiff = Infinity
  times.forEach((t, i) => {
    const diff = Math.abs(new Date(t).getTime() - targetMs)
    if (diff < minDiff) { minDiff = diff; closest = i }
  })
  return closest
}

function degreesToCardinal(degrees: number): string {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']
  return dirs[Math.round(degrees / 22.5) % 16]
}

function wmoCodeToCondition(code: number): string {
  if (code <= 1) return 'clear'
  if (code <= 3) return 'partly_cloudy'
  if (code <= 49) return 'foggy'
  if (code <= 69) return 'rain'
  if (code <= 79) return 'snow'
  if (code <= 99) return 'thunderstorm'
  return 'unknown'
}

function calculateImpactScore(params: {
  temp: number
  windSpeed: number
  precipChance: number
  precip: number
  humidity: number
}): number {
  let score = 0

  // Wind impact (most significant)
  if (params.windSpeed >= WEATHER_THRESHOLDS.WIND_HIGH_MPH) score += 0.35
  else if (params.windSpeed >= WEATHER_THRESHOLDS.WIND_SIGNIFICANT_MPH) score += 0.20

  // Temperature impact
  if (params.temp <= WEATHER_THRESHOLDS.TEMP_VERY_COLD_F) score += 0.30
  else if (params.temp <= WEATHER_THRESHOLDS.TEMP_COLD_F) score += 0.15

  // Precipitation impact
  if (params.precip > 0.1) score += 0.25
  else if (params.precipChance >= WEATHER_THRESHOLDS.PRECIP_CHANCE_NOTABLE) score += 0.10

  // Humidity impact (minor)
  if (params.humidity >= WEATHER_THRESHOLDS.HUMIDITY_HIGH) score += 0.05

  return Math.min(score, 1.0)
}

function generateImpactSummary(params: {
  temp: number
  windSpeed: number
  windDir: string
  precipChance: number
  condition: string
  impactScore: number
}): string {
  const parts: string[] = []

  if (params.windSpeed >= WEATHER_THRESHOLDS.WIND_HIGH_MPH) {
    parts.push(`Strong ${params.windDir} winds at ${Math.round(params.windSpeed)} mph — significant passing/kicking impact`)
  } else if (params.windSpeed >= WEATHER_THRESHOLDS.WIND_SIGNIFICANT_MPH) {
    parts.push(`${params.windDir} winds at ${Math.round(params.windSpeed)} mph — moderate weather factor`)
  }

  if (params.temp <= WEATHER_THRESHOLDS.TEMP_VERY_COLD_F) {
    parts.push(`Extreme cold (${Math.round(params.temp)}°F) — expect reduced scoring`)
  } else if (params.temp <= WEATHER_THRESHOLDS.TEMP_COLD_F) {
    parts.push(`Cold conditions (${Math.round(params.temp)}°F) — watch for ball-handling issues`)
  }

  if (params.condition === 'rain' || params.condition === 'thunderstorm') {
    parts.push(`${params.precipChance}% chance of precipitation — potential game-day adjustment`)
  }

  if (parts.length === 0) return 'Minimal weather impact expected'
  return parts.join('. ') + (params.impactScore > 0.5 ? ' HIGH IMPACT GAME.' : '.')
}
