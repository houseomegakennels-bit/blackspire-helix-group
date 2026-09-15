import type { BookRecord, AssetRecord } from "../../src/lib/book-studio/types";
export type Plan = { bookId: string; chapterId: string; chapterOrder: number; sourceDigest: string; sceneIds: string[]; missingImages: string[]; missingAudio: string[]; speechCharacters: number; needsVideo: boolean; reusedAssets: AssetRecord[]; publish: false };
export function digest(value: string | Buffer): string;
export function planPrivateChapter(book: BookRecord | null | undefined, bookId: string, chapterOrder: number, productionInputs?: unknown): Plan;
export function assertGenerationApproval(plan: Plan, approval: unknown): void;
export function writeVerifiedBackup(root: string, entries: {name: string; bytes: Buffer}[], metadata: Record<string, unknown>): Promise<{ files: {name: string; bytes: number; sha256: string; md5: string}[] }>;
export function assertReleaseEvidence(manifest: unknown, receipt: unknown, approval: unknown, qa: unknown): {eligibleForRelease: true; bookId: string; chapterId: string; videoSha256: string};

export function verifyReusedAssets(plan: Plan, approval: unknown, readAsset: (relativePath: string) => Promise<Buffer>): Promise<void>;
