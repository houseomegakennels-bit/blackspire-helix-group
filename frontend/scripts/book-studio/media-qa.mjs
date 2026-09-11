import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export async function verifyVideoFile(filePath, expectedAudioSeconds) {
 const {stdout}=await exec('ffprobe',['-v','error','-show_streams','-show_format','-of','json',filePath]);
 const probe=JSON.parse(stdout);const video=probe.streams.find(s=>s.codec_type==='video');const audio=probe.streams.find(s=>s.codec_type==='audio');
 const duration=Number(probe.format?.duration);
 if(!video || !audio || !Number.isFinite(duration) || duration<=0 || !Number.isFinite(Number(video.duration)) || !Number.isFinite(Number(audio.duration)) || Math.abs(Number(video.duration)-Number(audio.duration))>0.5)throw Error('Invalid or misaligned video/audio streams.');
 if(expectedAudioSeconds!==undefined && (!Number.isFinite(expectedAudioSeconds) || Math.abs(Number(audio.duration)-expectedAudioSeconds)>0.5))throw Error('Narration duration does not cover all scene audio.');
 await exec('ffmpeg',['-v','error','-xerror','-i',filePath,'-map','0:v:0','-map','0:a:0','-f','null','-'],{maxBuffer:1024*1024});
 return {fullDecodePassed:true,durationSeconds:duration,videoSeconds:Number(video.duration),audioSeconds:Number(audio.duration)};
}
export async function probeAudioSeconds(filePath) {
 const {stdout}=await exec('ffprobe',['-v','error','-select_streams','a:0','-show_entries','stream=duration','-of','json',filePath]);
 const duration=Number(JSON.parse(stdout).streams?.[0]?.duration);
 if(!Number.isFinite(duration)||duration<=0)throw Error('Missing or invalid scene audio.');
 return duration;
}
