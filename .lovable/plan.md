# Trip-media bucket splitsen

## Doel
De finding "Private trip media files are publicly accessible via direct URL" oplossen zonder Peecho-bestellingen of bestaande publieke trips te breken.

## Aanpak

### 1. Twee buckets naast elkaar
- **`trip-media`** (blijft publiek) — voor inherent publieke assets: profielfoto's (avatar), trip-cover, plattegronden, Peecho PDF's. Ook alle reeds bestaande bestanden blijven hier, dus geen brekende migratie van URL's in de database.
- **`trip-private`** (nieuw, privé) — voor alle **nieuwe** step-media (foto's en video's van updates). Bestaande step-media blijft via de publieke bucket; alleen nieuwe uploads krijgen de strenge gating.

### 2. Storage-RLS op `trip-private`
Pad-schema: `{userId}/{stepId}/{i}.{ext}` — `stepId` is het 2e padsegment.
- SELECT: eigenaar van het object, of `public.can_view_step((storage.foldername(name))[2]::uuid)`
- INSERT/UPDATE/DELETE: eigenaar (`auth.uid()` = bucket-folder eerste segment)

### 3. Schema-wijziging
`step_media` krijgt nullable kolom `storage_path text`. Bij nieuwe uploads vullen we `storage_path` met het pad in `trip-private`; `media_url` blijft leeg voor nieuwe rows. Voor legacy rows blijft `media_url` de bron.

### 4. Client-side render-helper
Nieuwe `src/lib/mediaUrl.ts` met `resolveMediaUrl(row)`:
- Heeft `storage_path` → `createSignedUrl("trip-private", path, 3600)` met in-memory cache per pad.
- Anders → bestaande `media_url`.

Alle plekken die `step_media.media_url` renderen (Timeline, Lightbox, AllPhotosTab, Photobook preview, BlueprintTimeline, ProjectCard, FloorplanScrollView, peecho-export) gaan via deze helper.

### 5. Upload-paden aanpassen
- `AddStepDialog` en `EditStepDialog`: uploaden naar `trip-private`, slaan `storage_path` op in `step_media`, laten `media_url` leeg.
- `CoverPickerDialog`, `Profile` (avatar), `TripDetail` (floorplan + blueprint), `Photobook` (PDF): blijven `trip-media` publiek.

### 6. Geen migratie van bestaande bestanden
Bestaande step-media blijft publiek bereikbaar — accepteren als bekend legacy risico, vastleggen in `security-memory`. Vanaf nu lekt nieuwe content niet meer.

## Bestanden

**Migratie**
- `supabase/migrations/<timestamp>_trip_private_storage.sql` — bucket via tool, RLS policies op `storage.objects` voor `trip-private`, `ALTER TABLE step_media ADD COLUMN storage_path text`.

**Nieuw**
- `src/lib/mediaUrl.ts`

**Aanpassen (uploads naar `trip-private` + `storage_path`)**
- `src/components/AddStepDialog.tsx`
- `src/components/EditStepDialog.tsx`

**Aanpassen (render via helper)**
- `src/components/StepTimeline.tsx`
- `src/components/BlueprintTimeline.tsx`
- `src/components/MediaLightbox.tsx`
- `src/components/AllPhotosTab.tsx`
- `src/components/ProjectCard.tsx`
- `src/components/BeforeAfterSlider.tsx` (indien direct media_url consumeert)
- `src/pages/Photobook.tsx` (preview)
- `src/lib/peechoExport.ts` (PDF embedding via signed URL)
- `src/lib/projectMedia.ts`

**Security-memory update** — markeer de finding als opgelost voor nieuwe uploads en documenteer dat legacy bestanden in de publieke bucket bewust niet gemigreerd worden.

## Niet in scope
- Migratie van bestaande publieke step-media naar de private bucket.
- Avatar/cover/floorplan/PDF private maken (blijven publiek; floorplan-privacy kan separaat opgepakt worden als je dat ook wil).

## Risico's
- Signed-URL helper moet 401's bij verlopen URLs netjes opvangen (cache met TTL korter dan signed-URL geldigheid).
- Peecho-export moet plaatjes als data-URL of via signed URL embedden, niet als publieke URL.