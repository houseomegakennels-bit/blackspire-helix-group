# Blackspire Buyer Engine

Blackspire Buyer Engine is a real estate intelligence product powered by Blackspire Helix Group.

Blackspire Helix Group hierarchy:

- Blackspire Helix Group: parent company
- Blackspire Buyer Engine: buyer intelligence and operator workflow product
- Blackspire Social OS: separate sibling product focused on cinematic AI media operations

This repository is only for Blackspire Buyer Engine. It should not be presented as the parent company and should remain conceptually separate from Blackspire Social OS even when the two products share brand language or infrastructure patterns.

## Stack

- Next.js App Router
- React
- Tailwind CSS
- Supabase-backed workflow and report data

## Getting Started

Run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open the local frontend in your browser after the server starts. If port `3000` is already used by another Blackspire product, start Buyer Engine on a dedicated port instead.

Example:

```powershell
$env:PORT="3000"
npm run dev
```

## Product Scope

Blackspire Buyer Engine currently centers on:

- search job creation
- buyer report generation
- export logging
- operator workflow monitoring
- county/source coverage management

## Brand Positioning

Use the naming structure consistently:

- `Blackspire Helix Group` for the parent company
- `Blackspire Buyer Engine` for this product
- `Blackspire Social OS` for the separate media-operations product

Do not describe Blackspire Buyer Engine as the parent platform for the whole Blackspire ecosystem.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

Production is deployed on Vercel:

- Live app: `https://frontend-tau-woad-73.vercel.app`
- Vercel project: `houseomegakennels-4825s-projects/frontend`
- Project ID: `prj_a9x4Tuzgzq6XrvtdtYNxONwL8Fou`

Required production environment variables:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BLACKSPIRE_DEFAULT_USER_ID`
- `N8N_WEBHOOK_BASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Do not use `https://blackspire-buyer-pulse.lovable.app` for production searches until the Lovable project is rebuilt against the current backend. That deployment points at the old Supabase project and stale workflow trigger path.
