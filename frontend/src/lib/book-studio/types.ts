export type BookStatus = "Draft" | "ApprovedForRender" | "Published";

export type SceneImageStatus = "missing" | "blocked" | "provisional" | "ready";

export type SceneAudioStatus = "missing" | "failed" | "ready";

export type ReferenceRole =
  | "character_reference"
  | "scene_reference"
  | "mood_reference"
  | "canonical_candidate"
  | "excluded";

export type ReferenceSource =
  | "upload"
  | "character_bible_import"
  | "portrait_generation"
  | "scene_generation"
  | "storyboard_derivation";

export type ReferenceDerivationKind = "none" | "storyboard_crop_upscale";

export type ReferenceDerivationStatus = "provisional" | "approved" | "rejected";

export type ReferenceCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AssetKind =
  | "manuscript"
  | "character_bible_document"
  | "reference_image"
  | "character_portrait"
  | "scene_image"
  | "scene_audio"
  | "chapter_audio"
  | "chapter_video"
  | "cover";

export type CharacterSex = "female" | "male" | "unknown";

export type CharacterStatus = "draft" | "locked";

export type ScenePriority = "key" | "supporting" | "background";

export type VoiceName =
  | "alloy"
  | "ash"
  | "ballad"
  | "coral"
  | "echo"
  | "fable"
  | "nova"
  | "onyx"
  | "sage"
  | "shimmer"
  | "verse"
  | "marin"
  | "cedar";

export type AssetRecord = {
  id: string;
  kind: AssetKind;
  label: string;
  mimeType: string;
  relativePath: string;
  createdAt: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type ReferenceRecord = {
  id: string;
  assetId: string;
  source: ReferenceSource;
  role: ReferenceRole;
  approved: boolean;
  characterIds: string[];
  sceneIds: string[];
  chapterIds: string[];
  sourceReferenceId: string | null;
  derivationKind: ReferenceDerivationKind;
  derivationStatus: ReferenceDerivationStatus;
  confidence: number | null;
  label: string | null;
  crop: ReferenceCrop | null;
  notes: string;
};

export type VoiceAssignment = {
  narratorVoice: VoiceName;
  characterVoice?: VoiceName;
  fallbackVoice: VoiceName;
  rationale: string;
};

export type CharacterBible = {
  id: string;
  name: string;
  aliases: string[];
  coreDescription: string;
  ageRange: string;
  sex: CharacterSex;
  facialTraits: string;
  bodyTraits: string;
  hair: string;
  vibe: string;
  continuityNotes: string;
  requiredForRender: boolean;
  status: CharacterStatus;
  canonicalReferenceId: string | null;
  backupReferenceIds: string[];
  voiceAssignment: VoiceAssignment | null;
};

export type SceneCharacterModifier = {
  characterId: string;
  label: string;
  description: string;
};

export type RenderManifest = {
  compiledPrompt: string;
  characterReferenceIds: string[];
  sceneReferenceIds: string[];
  moodReferenceIds: string[];
  visualAnchorReferenceIds: string[];
  styleNotes: string;
  modifiers: SceneCharacterModifier[];
};

export type SceneRecord = {
  id: string;
  chapterId: string;
  order: number;
  title: string;
  sourceText: string;
  summary: string;
  mood: string;
  location: string;
  timeOfDay: string;
  characterIds: string[];
  modifiers: SceneCharacterModifier[];
  imagePrompt: string;
  imageStatus: SceneImageStatus;
  audioStatus: SceneAudioStatus;
  reviewStatus: "pending" | "approved";
  priority: ScenePriority;
  imageAssetId: string | null;
  audioAssetId: string | null;
  estimatedDurationSeconds: number;
  renderManifest: RenderManifest | null;
};

export type ChapterRecord = {
  id: string;
  order: number;
  title: string;
  summary: string;
  sceneIds: string[];
  audioAssetId: string | null;
  videoAssetId: string | null;
};

export type BookRecord = {
  id: string;
  slug: string;
  title: string;
  synopsis: string;
  status: BookStatus;
  manuscriptText: string;
  manuscriptAssetId: string | null;
  coverAssetId: string | null;
  styleProfile: {
    visualDirection: string;
    palette: string;
    medium: string;
    tone: string;
  };
  chapters: ChapterRecord[];
  scenes: SceneRecord[];
  characters: CharacterBible[];
  references: ReferenceRecord[];
  assets: AssetRecord[];
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

export type BookStudioStore = {
  version: 1;
  books: BookRecord[];
  updatedAt: string;
};

export type BookListItem = Pick<
  BookRecord,
  "id" | "slug" | "title" | "synopsis" | "status" | "createdAt" | "updatedAt" | "publishedAt"
> & {
  chapterCount: number;
  sceneCount: number;
  characterCount: number;
};
