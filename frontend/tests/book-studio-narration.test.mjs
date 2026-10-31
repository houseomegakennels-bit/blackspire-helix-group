import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function setup(modelPayload) {
  let id = 0;
  const books = [fixture('target'), fixture('geminara')];
  const speech = [];
  const dependencies = {
    'server-only': {}, 'adm-zip': {},
    'node:fs/promises': { mkdir: async () => {}, readFile: async () => Buffer.from('synthetic') },
    'node:os': { tmpdir: () => '/synthetic' }, 'node:path': { join: (...parts) => parts.join('/') },
    '@/lib/book-studio/documents': {},
    '@/lib/book-studio/media': {
      runStructuredPrompt: async ({ fallback }) => modelPayload ?? fallback,
      generateSpeechAudio: async (input) => { speech.push(input); return { extension: 'wav', mimeType: 'audio/wav', durationSeconds: 50 }; },
    },
    '@/lib/book-studio/store': {
      createId: () => `id-${++id}`, slugify: text => text,
      readStore: async () => ({ books }),
      mutateBookRecord: async (bookId, update) => {
        const index = books.findIndex(book => book.id === bookId);
        assert.notEqual(index, -1);
        const book = await update(structuredClone(books[index]));
        books[index] = book;
        return { book };
      },
      writeAssetBuffer: async () => ({ id: `asset-${++id}` }),
      deleteAssetFile: () => assert.fail('Repair must retain media files'),
    },
  };
  function load(file, extra = '', globals = {}) {
    const source = readFileSync(new URL(`../src/${file}.ts`, import.meta.url), 'utf8') + extra;
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const exports = {};
    new vm.Script(js).runInNewContext({ exports, require: name => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    }, process: { env: {} }, Buffer, console, ...globals });
    return exports;
  }
  dependencies['@/lib/book-studio/types'] = load('lib/book-studio/types');
  const service = load('lib/book-studio/service', '\nexport { analyzeChapters, ensureSceneAudioAsset };');
  dependencies['@/lib/book-studio/service'] = { ...service, hydrateBookForClient: book => book };
  dependencies['@/lib/operator-access'] = { guardSignedInApi: async () => null };
  dependencies['next/server'] = { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } };
  return { books, service, speech, load, dependencies };
}
function fixture(id) {
  return { id, title: id, styleProfile: {}, references: [], assets: [{ id: 'old-scene' }, { id: 'old-audio' }, { id: 'old-video' }],
    characters: [{ id: `${id}-character`, name: 'Narrator', aliases: [], coreDescription: '', ageRange: 'adult', sex: 'male', backupReferenceIds: [], canonicalReferenceId: null, voiceAssignment: { narratorVoice: 'onyx', characterVoice: 'onyx', fallbackVoice: 'onyx', rationale: 'Established' } }],
    chapters: [{ id: `${id}-chapter`, sceneIds: [`${id}-scene`], audioAssetId: 'old-audio', videoAssetId: 'old-video' }],
    scenes: [{ id: `${id}-scene`, chapterId: `${id}-chapter`, title: 'Scene', sourceText: 'Old text', summary: '', characterIds: [`${id}-character`], modifiers: [], imageAssetId: 'image', audioAssetId: 'old-scene', audioStatus: 'ready' }],
  };
}
const fullText = '  Opening — “verbatim”.\r\n\r\n' + Array.from({ length: 10 }, (_, i) => `${i}: ${'Unaltered prose with punctuation! '.repeat(70)}\n \n`).join('') + 'THE END.  ';
for (const [name, payload] of [ ['fallback', undefined], ['plausible-length rewritten model text', { scenes: [{ sourceText: 'Invented prose. '.repeat(1300), characters: [] }], characters: [] }], ['only the analysis prefix', { scenes: [{ sourceText: fullText.slice(0, 12000), characters: [] }], characters: [] }] ]) {
  test(`analysis preserves every source byte with ${name}`, async () => {
    const { service } = setup(payload);
    const result = await service.analyzeChapters([{ id: 'chapter', title: 'Chapter One', text: fullText, order: 1 }], 'Synthetic');
    assert.equal(result.scenes.map(scene => scene.sourceText).join(''), fullText);
    assert.equal(result.scenes.length, 11);
    assert.equal(result.scenes.filter(scene => scene.sourceText.length > 1400).length, 10);
    assert.equal(result.scenes.reduce((total, scene) => total + scene.sourceText.length, 0), fullText.length);
  });
}
test('scene PATCH preserves exact replacement, invalidates dependent playback, and leaves other books and assets intact', async () => {
  const s = setup(); const before = structuredClone(s.books[1]);
  const route = s.load('app/api/scenes/[sceneId]/route');
  const response = await route.PATCH({ json: async () => ({ sourceText: fullText }) }, { params: Promise.resolve({ sceneId: 'target-scene' }) });
  assert.equal(response.status, 200);
  const scene = s.books[0].scenes[0];
  assert.equal(scene.sourceText, fullText);
  assert.equal(scene.audioAssetId, null); assert.equal(scene.audioStatus, 'missing');
  assert.equal(scene.imageAssetId, 'image');
  assert.equal(s.books[0].chapters[0].audioAssetId, null); assert.equal(s.books[0].chapters[0].videoAssetId, null);
  assert.equal(s.books[0].assets.length, 3);
  assert.deepEqual(s.books[1], before);
  await s.service.ensureSceneAudioAsset(s.books[0], scene);
  assert.equal(s.speech[0].text, fullText); assert.equal(s.speech[0].voice, 'onyx');
});
test('character PATCH supports Onyx and invalidates only dependent playback', async () => {
  const s = setup(); s.books[0].characters[0].voiceAssignment.characterVoice = 'cedar';
  const before = structuredClone(s.books[1]);
  const assignment = { narratorVoice: 'onyx', characterVoice: 'onyx', fallbackVoice: 'onyx', rationale: 'Selected explicitly' };
  const response = await s.load('app/api/characters/[characterId]/route').PATCH({ json: async () => ({ voiceAssignment: assignment }) }, { params: Promise.resolve({ characterId: 'target-character' }) });
  assert.equal(response.status, 200);
  assert.equal(s.books[0].characters[0].voiceAssignment.characterVoice, 'onyx');
  assert.equal(s.books[0].scenes[0].audioAssetId, null);
  assert.deepEqual(s.books[1], before);
});
test('invalid source text and voices fail before mutation; identical source preserves playback', async () => {
  const s = setup(); const before = JSON.stringify(s.books);
  for (const sourceText of ['', '   ', 123, null]) await assert.rejects(s.service.updateScene('target-scene', { sourceText }));
  for (const voiceAssignment of [{ characterVoice: 'made-up' }, null, 'onyx']) await assert.rejects(s.service.updateCharacterBible('target-character', { voiceAssignment }));
  assert.equal(JSON.stringify(s.books), before);
  await s.service.updateScene('target-scene', { sourceText: 'Old text' });
  assert.equal(s.books[0].scenes[0].audioAssetId, 'old-scene');
});
test('automatic assignments preserve an explicitly established Onyx voice', async () => {
  const s = setup(); const before = structuredClone(s.books[0].characters[0].voiceAssignment);
  await s.service.assignVoices('target');
  assert.deepEqual(s.books[0].characters[0].voiceAssignment, before);
});

test('scene and character PATCH retain the existing signed-in guard before reading input', async () => {
  const s = setup(); const before = JSON.stringify(s.books);
  s.dependencies['@/lib/operator-access'] = { guardSignedInApi: async () => ({ status: 401 }) };
  for (const path of ['scenes/[sceneId]', 'characters/[characterId]']) {
    const result = await s.load(`app/api/${path}/route`).PATCH({ json: () => assert.fail('Denied body read') }, { params: Promise.resolve({}) });
    assert.equal(result.status, 401);
  }
  assert.equal(JSON.stringify(s.books), before);
});
test('complete verbatim model scenes retain their metadata and narration', async () => {
  const s = setup({ scenes: [{ title: 'Model title', sourceText: fullText, characters: [] }], characters: [] });
  const result = await s.service.analyzeChapters([{ id: 'chapter', title: 'Chapter One', text: fullText, order: 1 }], 'Synthetic');
  assert.equal(result.scenes.length, 1);
  assert.equal(result.scenes[0].title, 'Model title');
  assert.equal(result.scenes[0].sourceText, fullText);
});

// Observe the actual outbound JSON without dispatching a request or using credentials.
test('saved Onyx selection reaches the actual speech HTTP request body', async () => {
  const s = setup();
  s.books[0].characters[0].voiceAssignment.characterVoice = 'cedar';
  const assignment = { narratorVoice: 'onyx', characterVoice: 'onyx', fallbackVoice: 'onyx', rationale: 'Explicit selection' };
  const response = await s.load('app/api/characters/[characterId]/route').PATCH(
    { json: async () => ({ voiceAssignment: assignment }) },
    { params: Promise.resolve({ characterId: 'target-character' }) },
  );
  assert.equal(response.status, 200);
  const requests = [];
  s.dependencies['node:child_process'] = { spawn: () => assert.fail('No media process allowed') };
  s.dependencies['node:fs/promises'].unlink = async () => {};
  const media = s.load('lib/book-studio/media', '', {
    process: { env: { OPENAI_API_KEY: 'synthetic-test-only' } },
    AbortSignal,
    fetch: async (url, options) => {
      requests.push({ url, method: options.method, body: JSON.parse(options.body) });
      return { ok: false, status: 503, text: async () => 'Synthetic stop before generation' };
    },
  });
  s.dependencies['@/lib/book-studio/media'].generateSpeechAudio = media.generateSpeechAudio;
  await assert.rejects(s.service.ensureSceneAudioAsset(s.books[0], s.books[0].scenes[0]), /Synthetic stop before generation/);
  assert.deepEqual(requests, [{
    url: 'https://api.openai.com/v1/audio/speech', method: 'POST',
    body: { model: 'gpt-4o-mini-tts', voice: 'onyx', input: 'Old text', response_format: 'wav' },
  }]);
});

test('explicit scene Onyx overrides empty or conflicting cast without changing character identity', async () => {
  const s = setup(); const untouched = structuredClone(s.books[1]);
  for (const characterIds of [[], ['target-character']]) {
    s.books[0].scenes[0].characterIds = characterIds;
    s.books[0].characters[0].voiceAssignment.characterVoice = 'cedar';
    const response = await s.load('app/api/scenes/[sceneId]/route').PATCH(
      { json: async () => ({ narrationVoice: 'onyx' }) }, { params: Promise.resolve({ sceneId: 'target-scene' }) });
    assert.equal(response.status, 200);
    assert.equal(s.books[0].scenes[0].renderManifest.narrationVoice, 'onyx');
    assert.deepEqual(s.books[0].scenes[0].characterIds, characterIds);
    await s.service.ensureSceneAudioAsset(s.books[0], s.books[0].scenes[0]);
    assert.equal(s.speech.at(-1).voice, 'onyx');
  }
  assert.deepEqual(s.books[1], untouched);
});
test('invalid explicit narration voice is rejected on save and render, never silently falls back', async () => {
  const s = setup(); const before = JSON.stringify(s.books);
  for (const narrationVoice of ['', 'ONYX', 'invented', 123, {}]) await assert.rejects(s.service.updateScene('target-scene', { narrationVoice }));
  assert.equal(JSON.stringify(s.books), before);
  s.books[0].scenes[0].renderManifest = { narrationVoice: 'invalid' };
  await assert.rejects(s.service.ensureSceneAudioAsset(s.books[0], s.books[0].scenes[0]), /voice/i);
  assert.equal(s.speech.length, 0);
});
test('effective voice changes invalidate playback; identical override and unrelated cast voice preserve it', async () => {
  const s = setup();
  s.books[0].characters[0].voiceAssignment.characterVoice = 'cedar';
  await s.service.updateScene('target-scene', { narrationVoice: 'onyx' });
  assert.equal(s.books[0].scenes[0].audioAssetId, null);
  assert.equal(s.books[0].chapters[0].videoAssetId, null);
  s.books[0].scenes[0].audioAssetId = 'retained';
  await s.service.updateScene('target-scene', { narrationVoice: 'onyx' });
  await s.service.updateCharacterBible('target-character', { voiceAssignment: { narratorVoice: 'ash', characterVoice: 'ash', fallbackVoice: 'sage', rationale: 'Changed character' } });
  assert.equal(s.books[0].scenes[0].audioAssetId, 'retained');
  await s.service.updateScene('target-scene', { narrationVoice: null });
  assert.equal(s.books[0].scenes[0].audioAssetId, null);
  await s.service.ensureSceneAudioAsset(s.books[0], s.books[0].scenes[0]);
  assert.equal(s.speech.at(-1).voice, 'ash');
});

test('scene voice survives existing JSON database serialization and prompt rebuilds without a new column', async () => {
  const s = setup(); const rows = new Map();
  s.dependencies['@supabase/supabase-js'] = {};
  const store = s.load('lib/book-studio/store', '\nexport { persistBookToDatabase, toBookRecord };', { process: { env: {}, cwd: () => '/synthetic' } });
  const client = { from(table) { return {
    select() { return {
      limit: async () => ({ error: null }),
      eq: async () => ({ data: [], error: null }),
    }; },
    upsert: async value => { rows.set(table, structuredClone(value)); return { error: null }; },
  }; } };
  await s.service.updateScene('target-scene', { narrationVoice: 'onyx' });
  await s.service.updateScene('target-scene', { mood: 'tense' });
  await s.service.updateCharacterBible('target-character', { coreDescription: 'New visual notes' });
  assert.equal(s.books[0].scenes[0].renderManifest.narrationVoice, 'onyx');
  await store.persistBookToDatabase(client, s.books[0]);
  const restored = store.toBookRecord({ book: rows.get('book_studio_books'), scenes: rows.get('book_studio_scenes'), chapters: rows.get('book_studio_chapters'), characters: rows.get('book_studio_characters'), assets: rows.get('book_studio_assets'), references: [] });
  assert.equal(restored.scenes[0].renderManifest.narrationVoice, 'onyx');
  assert.equal(Object.hasOwn(rows.get('book_studio_scenes')[0], 'narration_voice'), false);
  assert.equal(Object.hasOwn(restored.scenes[0], 'narrationVoice'), false);
  assert.equal(restored.scenes[0].sourceText, 'Old text');
  assert.deepEqual(Array.from(restored.scenes[0].characterIds), ['target-character']);
});

test('explicit castless scene Onyx reaches the actual speech HTTP request body', async () => {
  const s = setup();
  s.books[0].scenes[0].characterIds = [];
  const response = await s.load('app/api/scenes/[sceneId]/route').PATCH(
    { json: async () => ({ narrationVoice: 'onyx' }) },
    { params: Promise.resolve({ sceneId: 'target-scene' }) },
  );
  assert.equal(response.status, 200);
  const requests = [];
  s.dependencies['node:child_process'] = { spawn: () => assert.fail('No media process allowed') };
  s.dependencies['node:fs/promises'].unlink = async () => {};
  const media = s.load('lib/book-studio/media', '', {
    process: { env: { OPENAI_API_KEY: 'synthetic-test-only' } },
    AbortSignal,
    fetch: async (url, options) => {
      requests.push({ url, method: options.method, body: JSON.parse(options.body) });
      return { ok: false, status: 503, text: async () => 'Synthetic stop before generation' };
    },
  });
  s.dependencies['@/lib/book-studio/media'].generateSpeechAudio = media.generateSpeechAudio;
  await assert.rejects(s.service.ensureSceneAudioAsset(s.books[0], s.books[0].scenes[0]), /Synthetic stop before generation/);
  assert.deepEqual(requests, [{
    url: 'https://api.openai.com/v1/audio/speech', method: 'POST',
    body: { model: 'gpt-4o-mini-tts', voice: 'onyx', input: 'Old text', response_format: 'wav' },
  }]);
});

test('speech chunks stay bounded and preserve exact source for oversized sentences and words', () => {
  const s = setup(); s.dependencies['node:child_process'] = {};
  const media = s.load('lib/book-studio/media', '\nexport { splitTextForSpeech };');
  for (const text of ['word '.repeat(2000).trim(), 'X'.repeat(8000), '😀'.repeat(3000), '  First.\n\n' + 'Unbroken text '.repeat(1500) + ' End.\n']) {
    const chunks = media.splitTextForSpeech(text);
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every(chunk => chunk.length > 0 && chunk.length <= 3900));
    assert.equal(chunks.join(''), text);
    assert.ok(chunks.every(chunk => !/[\uD800-\uDBFF]$/.test(chunk)));
  }
});
