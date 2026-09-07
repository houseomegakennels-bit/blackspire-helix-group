export function verifyVideoFile(filePath: string, expectedAudioSeconds?: number): Promise<{fullDecodePassed: true; durationSeconds: number; videoSeconds: number; audioSeconds: number}>;
export function probeAudioSeconds(filePath: string): Promise<number>;
