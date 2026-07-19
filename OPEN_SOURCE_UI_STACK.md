# Open-Source UI Stack — Blackspire Jarvis PWA

Last updated: 2026-07-18 on `feature/jarvis-pwa-ui`.

## Selection result

Jarvis remains a dependency-free static PWA because the existing repository
has no frontend build pipeline or runtime dependencies and the backend exposes
only fixed routes for the HTML shell, manifest, and service worker. No package
manager was changed, no install script was run, and no third-party repository
was placed inside Blackspire.

The shipped UI consists of original HTML, CSS, JavaScript, inline SVG icons,
manifest artwork, and a first-party native WebGL enhancement. The optional
enhancement is dynamically imported from `/helix-core.js`; the current backend
does not serve that route, so the accessible SVG/CSS implementation remains
the verified runtime path. This backend gap is recorded in
`JARVIS_UI_BACKEND_GAPS.md`.

## Engineering and design skills

The official Codex skill installer cached only the selected folders under
`/tmp/blackspire-open-source-skills/installed`; source checkouts are under
`/tmp/blackspire-open-source-skills/repos`. `SUPERPOWERS_DISABLE_TELEMETRY=1`
was set for the temporary session. These paths are outside the repository and
are not committed or shipped.

| Repository | Exact commit | Selected folders | License | Use |
|---|---|---|---|---|
| `obra/superpowers` | `d884ae04edebef577e82ff7c4e143debd0bbec99` | brainstorming, writing-plans, test-driven-development, systematic-debugging, using-git-worktrees, verification-before-completion, requesting-code-review, receiving-code-review, finishing-a-development-branch | MIT | TDD, debugging, review, worktree, verification, and branch-finish playbooks |
| `anthropics/skills` | `fa0fa64bdc967915dc8399e803be67759e1e62b8` | frontend-design, theme-factory, web-artifacts-builder, webapp-testing, skill-creator | Apache-2.0 per selected folder `LICENSE.txt` | Original visual direction, token discipline, testing method, and project-skill authoring |

The PDF, DOCX, PPTX, and XLSX folders were not installed, read, copied, or
used. The project-scoped skill is original Blackspire work at
`.agents/skills/blackspire-jarvis-interface`; no third-party skill content is
copied into it.

## UI repository discovery audit

All repositories were shallowly retrieved outside Blackspire and inspected at
the exact commits below. “Referenced” means design or engineering comparison
only; it adds zero browser bytes. “Adapted concept” means an original
reimplementation, not copied source.

| Repository | Exact commit | License | Installed/copied | Browser impact | Purpose and selection decision |
|---|---|---|---|---|---|
| `shadcn-ui/ui` | `d28738b183c5eaa69d8d540826e450f30d39ab6c` | MIT | Referenced; nothing copied | 0 B | Compared token, focus, and component composition patterns; rejected as incompatible with the no-React surface |
| `radix-ui/primitives` | `f0864ebdd5619bdd8420d006194b13af231f82ab` | MIT | Referenced; nothing copied | 0 B | Compared accessible primitive behavior; no package needed for native controls |
| `magicuidesign/magicui` | `61f1aa5aa28dafa459e7d011e46ce2392b22ee24` | MIT | Shimmer/list-entry concepts adapted; no source copied | Original CSS only | Restrained submit feedback and ordered-event entry motion; attribution preserved here and in CSS comments |
| `motiondivision/motion` | `61833240e899fbbe4f50484ec5f9f7fe688de843` | MIT | Referenced; nothing copied | 0 B | Compared reduced-motion and lifecycle patterns; native CSS/RAF was smaller |
| `lucide-icons/lucide` | `658573b0171e693bc965c167592cc0b92d002a3e` | ISC; some derived icons MIT | Referenced; no icon copied | 0 B | Compared 24×24 stroke conventions; shipped icons are original inline SVG |
| `mrdoob/three.js` | `1a8157ae5c51c09166bcbe104a48a06568e64385` | MIT | Referenced; nothing copied | 0 B | Evaluated for the Helix; native WebGL avoids a large incompatible runtime dependency |
| `pmndrs/react-three-fiber` | `7dfaeaaab270ebef2b176e8bcaa5819702c34794` | MIT | Referenced; nothing copied | 0 B | Rejected because Jarvis is not React |
| `pmndrs/drei` | `c9d3d0dc9473f026c83965a7eb8c7f7a1a1bf0ae` | MIT | Referenced; nothing copied | 0 B | Rejected because Jarvis is not React and needs no model helpers |
| `fontsource/fontsource` | `03f64b50dc875628190636c4141c17d4f2b07b11` | MIT packaging; individual fonts vary | Referenced; no font copied | 0 B | Self-hosting evaluated; fixed backend routes currently prevent font assets, so local system stacks ship |
| `serwist/serwist` | `7bf353a4d752c14fe9b604aded7ceba1772a5704` | MIT | Referenced; nothing copied | 0 B | Existing hand-written service worker is smaller and framework-compatible |

All inspected repositories had recent activity at retrieval time and
permissive licenses. Commit pins, rather than mutable branch names, are the
maintenance baseline for this audit.

## Added dependencies and copied components

- npm dependencies added: none; `package.json` and `package-lock.json` remain
  unchanged.
- components installed: none.
- components copied verbatim: none.
- third-party browser code: none.
- attribution requirement: Magic UI’s MIT-derived design concepts are noted
  above and in implementation comments; no other shipped third-party work
  requires a bundled notice.

## Rejections and supply-chain controls

Unknown, noncommercial, personal-use-only, source-available, proprietary,
paid, trial, credentialed, suspicious-script, and frontend-secret-bearing
resources were rejected automatically. No Marvel, Iron Man, Stark Industries,
Arc Reactor, film HUD, proprietary artwork, texture, model, sound, tracker,
analytics, advertising, or remote core asset is present.

Final validation uses the repository’s `npm audit`, license scan, secret scan,
full test suite, and `git diff --check`; exact outcomes are recorded in
`JARVIS_UI_IMPLEMENTATION_STATUS.md` after the final run.
