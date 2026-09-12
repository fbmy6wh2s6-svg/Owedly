# Owedly

Voice-first office manager for contractors.

## Current development baseline

This repository is the production frontend codebase for Owedly. It is being rebuilt against the production Supabase project as the single source of truth.

### Stack

- React + TypeScript + Vite
- Supabase Auth + Postgres + RLS
- Supabase Edge Functions for AI/voice actions

### Local setup

1. Copy `.env.example` to `.env.local`.
2. Install dependencies with `npm install`.
3. Run `npm run dev`.

The production Supabase URL and publishable key are safe client-side values, but are still kept in environment variables for clean deployment configuration.
