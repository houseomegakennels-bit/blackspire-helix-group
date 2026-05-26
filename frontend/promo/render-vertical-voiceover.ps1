Add-Type -AssemblyName System.Speech

$text = @"
Launch a county buyer sweep.
Set the county, property type, and date window in one command surface.
Track the job live.
Watch the queue move from pending to processing while the workflow scores buyers.
Open ranked buyer dossiers.
Review buyers, export the cohort, and move straight into outreach ready actions.
"@

$output = "C:\Users\USER\Desktop\blackspire-helix-group\frontend\promo\out\blackspire-buyer-engine-vertical-demo-voiceover.wav"

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice("Microsoft Zira Desktop")
$synth.Rate = -1
$synth.Volume = 100
$synth.SetOutputToWaveFile($output)
$synth.Speak($text)
$synth.Dispose()
