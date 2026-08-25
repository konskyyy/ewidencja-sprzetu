-- =====================================================================
--  Pozycje materiałowe — kategorie Inklinometry / Czujniki drgań / HLC
--
--  Liczone ilościowo (quantity), nie jako egzemplarze.
--  W tabeli: type='material', status=kategoria, quantity=stan.
--
--  UWAGA na ograniczenie assets_storage_location_chk:
--    in_storage = true  =>  warehouse NOT NULL oraz lat/lng NULL
--  Dlatego każda pozycja ma przypisany magazyn.
--
--  Skrypt idempotentny — dopasowanie po nazwie i kategorii.
-- =====================================================================

INSERT INTO assets (name, type, status, quantity, unit, warehouse, notes, in_storage, lat, lng)
SELECT v.name, 'material', v.kategoria, v.stan, v.jednostka, v.magazyn, v.uwagi, true, NULL, NULL
FROM (VALUES
  -- ---------- INKLINOMETRY ----------
  ('Rury inklinometryczne XC', 'inklinometry',   240, 'szt.', 'GEO_BB', 'Odcinki 3 m'),
  ('Mufy XC',                  'inklinometry',    85, 'szt.', 'GEO_BB', 'Łączniki do rur XC'),
  ('Zatyczki do rur',          'inklinometry',   120, 'szt.', 'GEO_BB', 'Górne i dolne'),

  -- ---------- CZUJNIKI DRGAŃ ----------
  ('Czujnik Sigicom',          'czujniki_drgan',   6, 'szt.', 'GEO_OM', 'Infra sieciowe'),
  ('Czujnik Svantek',          'czujniki_drgan',   4, 'szt.', 'GEO_OM', 'SV 258 / SV 259'),

  -- ---------- CZUJNIKI HLC ----------
  ('Czujnik HLC',              'hlc',             12, 'szt.', 'GEO_LD', 'Hydrostatyczny pomiar osiadań')
) AS v(name, kategoria, stan, jednostka, magazyn, uwagi)
WHERE NOT EXISTS (
  SELECT 1 FROM assets a
  WHERE a.type = 'material' AND a.name = v.name AND a.status = v.kategoria
);

-- Podsumowanie
SELECT status AS kategoria, name AS pozycja, quantity AS stan, unit AS jednostka, warehouse AS magazyn
FROM assets
WHERE type = 'material'
ORDER BY status, name;
