-- ─────────────────────────────────────────────────────────────────────────────
-- FAZA 19 — Etapa 19.1: Market (anunțuri de vânzare) — tabele + RLS + Storage + garzi
-- Rulează în Supabase Studio → SQL Editor. Idempotentă.
-- Plan: PLAN_FAZA19.md §2. Modelele clonate: announcement_photos (9.1.1), limite foto
-- (14.E8), ban prin trigger (16.2), search unaccent (7.3a/18.0).
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. market_listings ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS market_listings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 80),
  description text NOT NULL CHECK (char_length(description) <= 4000),
  price       numeric(12,2) NOT NULL CHECK (price > 0),
  currency    text NOT NULL DEFAULT 'EUR' CHECK (currency IN ('RON','EUR')),
  category    text NOT NULL CHECK (category IN ('tires','parts','trucks','trailers','accessories','other')),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','sold')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_listings_status_created
  ON market_listings(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_listings_seller
  ON market_listings(seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_listings_category_active
  ON market_listings(category) WHERE status = 'active';

-- set_updated_at() există din migration_full (trigger-ul anunțurilor).
DROP TRIGGER IF EXISTS market_listings_updated_at ON market_listings;
CREATE TRIGGER market_listings_updated_at
  BEFORE UPDATE ON market_listings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE market_listings ENABLE ROW LEVEL SECURITY;

-- SELECT: activ + vândut, ambele vizibile autentificaților (decizia §2.4: „sold" e ascuns
-- din grilă prin FILTRUL clientului, dar rămâne accesibil prin link direct, ca embed-ul
-- din conversații să poată distinge „Vândut" de „șters"). Cele 4 politici din plan
-- (active/own/sold/admin) colapsează logic într-una singură — documentat aici ca punctul
-- de re-separare dacă vreodată ascundem „sold" după N zile.
DROP POLICY IF EXISTS "market_select_authenticated" ON market_listings;
CREATE POLICY "market_select_authenticated" ON market_listings
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Blocarea (Faza 18): anunțurile perechii blocate dispar, cu excepțiile owner/admin.
-- RESTRICTIVE = AND peste politica permisivă de mai sus.
DROP POLICY IF EXISTS "market_select_not_blocked" ON market_listings;
CREATE POLICY "market_select_not_blocked" ON market_listings
  AS RESTRICTIVE FOR SELECT USING (
    seller_id = auth.uid()
    OR is_admin()
    OR NOT is_block_between(seller_id, auth.uid())
  );

-- Ambele roluri postează — fără restricție de rol (banul se aplică prin trigger, mai jos).
DROP POLICY IF EXISTS "market_insert_own" ON market_listings;
CREATE POLICY "market_insert_own" ON market_listings
  FOR INSERT WITH CHECK (seller_id = auth.uid());

DROP POLICY IF EXISTS "market_update_own" ON market_listings;
CREATE POLICY "market_update_own" ON market_listings
  FOR UPDATE USING (seller_id = auth.uid()) WITH CHECK (seller_id = auth.uid());

DROP POLICY IF EXISTS "market_delete_own" ON market_listings;
CREATE POLICY "market_delete_own" ON market_listings
  FOR DELETE USING (seller_id = auth.uid());

-- ─── 2. market_listing_photos ───────────────────────────────────────────────
-- Abatere motivată de la modelul announcement_photos: coloana `position` — anunțul de
-- market e EDITABIL, deci cover-ul (position 0) trebuie să fie mutabil, nu „prima urcată".
CREATE TABLE IF NOT EXISTS market_listing_photos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id   uuid NOT NULL REFERENCES market_listings(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  position     smallint NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_listing_photos_listing
  ON market_listing_photos(listing_id, position);

ALTER TABLE market_listing_photos ENABLE ROW LEVEL SECURITY;

-- Vizibilitatea pozelor o urmează pe cea a anunțului (RLS-ul de pe market_listings se
-- aplică în subinterogare — inclusiv RESTRICTIVE-ul de blocare, politica e INVOKER-side).
DROP POLICY IF EXISTS "market_photos_select" ON market_listing_photos;
CREATE POLICY "market_photos_select" ON market_listing_photos
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM market_listings l WHERE l.id = listing_id)
  );

DROP POLICY IF EXISTS "market_photos_insert_seller" ON market_listing_photos;
CREATE POLICY "market_photos_insert_seller" ON market_listing_photos
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM market_listings l WHERE l.id = listing_id AND l.seller_id = auth.uid())
  );

-- UPDATE doar pe `position` (reordonare/cover) — seller-ul propriu.
DROP POLICY IF EXISTS "market_photos_update_seller" ON market_listing_photos;
CREATE POLICY "market_photos_update_seller" ON market_listing_photos
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM market_listings l WHERE l.id = listing_id AND l.seller_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM market_listings l WHERE l.id = listing_id AND l.seller_id = auth.uid())
  );

DROP POLICY IF EXISTS "market_photos_delete_seller" ON market_listing_photos;
CREATE POLICY "market_photos_delete_seller" ON market_listing_photos
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM market_listings l WHERE l.id = listing_id AND l.seller_id = auth.uid())
  );

-- ─── 3. Garda de ban (modelul Fazei 16: trigger, NU restrictive RLS) ────────
DROP TRIGGER IF EXISTS ban_guard_ins ON market_listings;
CREATE TRIGGER ban_guard_ins BEFORE INSERT OR UPDATE ON market_listings
  FOR EACH ROW EXECUTE FUNCTION guard_not_banned();

DROP TRIGGER IF EXISTS ban_guard_ins ON market_listing_photos;
CREATE TRIGGER ban_guard_ins BEFORE INSERT ON market_listing_photos
  FOR EACH ROW EXECUTE FUNCTION guard_not_banned();

-- ─── 4. Limite: 10 poze / anunț + 20 anunțuri active / vânzător ─────────────
CREATE OR REPLACE FUNCTION enforce_market_photo_limit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM market_listing_photos WHERE listing_id = NEW.listing_id) >= 10 THEN
    RAISE EXCEPTION 'photo_limit_reached';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_market_photo_limit ON market_listing_photos;
CREATE TRIGGER trg_market_photo_limit
  BEFORE INSERT ON market_listing_photos
  FOR EACH ROW EXECUTE FUNCTION enforce_market_photo_limit();

-- Anti-spam (aprobat §8.5): max 20 anunțuri ACTIVE per vânzător. Se aplică la INSERT și
-- la re-activarea unui „sold" (UPDATE sold→active).
CREATE OR REPLACE FUNCTION enforce_market_listing_limit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'active'
     AND (TG_OP = 'INSERT' OR OLD.status <> 'active')
     AND (SELECT count(*) FROM market_listings
          WHERE seller_id = NEW.seller_id AND status = 'active') >= 20 THEN
    RAISE EXCEPTION 'listing_limit_reached';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_market_listing_limit ON market_listings;
CREATE TRIGGER trg_market_listing_limit
  BEFORE INSERT OR UPDATE ON market_listings
  FOR EACH ROW EXECUTE FUNCTION enforce_market_listing_limit();

-- ─── 5. Storage: folderul market/ în bucketul photos ────────────────────────
-- `objects.name` CALIFICAT obligatoriu (lecția din 9.2.4 — coloana `name` a tabelei
-- din subinterogare captura referința).
DROP POLICY IF EXISTS "photos_insert_market" ON storage.objects;
CREATE POLICY "photos_insert_market" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'photos'
    AND (storage.foldername(objects.name))[1] = 'market'
    AND EXISTS (
      SELECT 1 FROM market_listings l
      WHERE l.id::text = (storage.foldername(objects.name))[2] AND l.seller_id = auth.uid()
    )
  );

-- SELECT: autentificat + anunțul există (fără condiție de status — pozele anunțurilor
-- „sold" rămân vizibile pentru contextul din conversații, §2.4).
DROP POLICY IF EXISTS "photos_select_market" ON storage.objects;
CREATE POLICY "photos_select_market" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'photos'
    AND (storage.foldername(objects.name))[1] = 'market'
    AND EXISTS (
      SELECT 1 FROM market_listings l
      WHERE l.id::text = (storage.foldername(objects.name))[2]
    )
  );

DROP POLICY IF EXISTS "photos_delete_market" ON storage.objects;
CREATE POLICY "photos_delete_market" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'photos'
    AND (storage.foldername(objects.name))[1] = 'market'
    AND EXISTS (
      SELECT 1 FROM market_listings l
      WHERE l.id::text = (storage.foldername(objects.name))[2] AND l.seller_id = auth.uid()
    )
  );

-- ─── 6. Căutare server-side (paginarea face căutarea client-side incorectă) ─
-- Modelul search_mechanics (7.3a + garda de blocare 18.0). SECURITY INVOKER => RLS-ul
-- (inclusiv RESTRICTIVE-ul de blocare) se aplică; NOT is_block_between rămâne ca
-- centură de siguranță explicită, simetric cu search_mechanics.
CREATE OR REPLACE FUNCTION search_market_listings(
  p_query    text,
  p_category text DEFAULT NULL,
  p_sort     text DEFAULT 'recent',    -- 'recent' | 'price_asc' | 'price_desc'
  p_limit    integer DEFAULT 30,
  p_offset   integer DEFAULT 0
)
RETURNS SETOF market_listings
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT l.*
  FROM market_listings l
  WHERE l.status = 'active'
    AND NOT is_block_between(l.seller_id, auth.uid())
    AND (p_category IS NULL OR l.category = p_category)
    AND extensions.unaccent(replace(lower(l.title || ' ' || l.description), 'ß', 'ss'))
        LIKE '%' || extensions.unaccent(replace(lower(p_query), 'ß', 'ss')) || '%'
  ORDER BY
    CASE WHEN p_sort = 'price_asc'  THEN l.price END ASC,
    CASE WHEN p_sort = 'price_desc' THEN l.price END DESC,
    l.created_at DESC
  LIMIT least(greatest(p_limit, 1), 60) OFFSET greatest(p_offset, 0);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificări (Studio, simulare authenticated — vezi memoria feedback_studio_rls_test):
--  a) INSERT anunț propriu → OK; cu seller_id al altcuiva → RLS refuz.
--  b) UPDATE/DELETE pe anunțul altuia → 0 rânduri afectate.
--  c) Cont banat: INSERT → account_banned (trigger).
--  d) A 11-a poză pe același anunț → photo_limit_reached.
--  e) Al 21-lea anunț activ al aceluiași seller → listing_limit_reached.
--  f) User blocat de seller: SELECT nu întoarce anunțurile seller-ului (restrictive).
--  g) search_market_listings('anvelope') → doar active, fără perechile blocate.
-- ─────────────────────────────────────────────────────────────────────────────
