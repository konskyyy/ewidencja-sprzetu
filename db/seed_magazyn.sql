-- =====================================================================
--  Przykładowy sprzęt magazynowy — dane demonstracyjne
--  Uruchom na bazie aplikacji, żeby wykresy w trybie "Stan magazynowy"
--  miały co pokazywać.
--
--  Skrypt jest idempotentny: ponowne uruchomienie nie zduplikuje
--  rekordów (dopasowanie po nazwie urządzenia).
--
--  Urządzenia magazynowe nie mają współrzędnych (in_storage = true,
--  lat/lng = NULL) — zgodnie z logiką normalizeStorage w backendzie.
--
--  Typ urządzenia trzymany jest w kolumnie `status`
--  (`type` = 'equipment' oznacza kategorię rekordu, nie rodzaj sprzętu).
--
--  Daty kalibracji celowo rozłożone tak, aby wykres "Stan kalibracji"
--  pokazał wszystkie cztery stany: po terminie, wkrótce, aktualna,
--  brak daty. Interwał musi być 1, 2 albo 3 (ograniczenie tabeli).
-- =====================================================================

INSERT INTO assets (name, type, status, lat, lng, notes, in_storage, warehouse, priority, last_calibration_at, calibration_interval_years)
SELECT v.name, 'equipment', v.status,
       NULL::double precision, NULL::double precision,
       v.notes, true, v.warehouse, v.priority,
       v.last_cal::timestamptz, v.interval_years::int
FROM (VALUES
  -- ---------- INKLINOMETRY ----------
  ('Inklinometr Sisgeo S242',      'inklinometr',   'GEO_BB', false, (now() - interval '20 months')::timestamptz, 1, 'Sonda inklinometryczna, kabel 50 m'),
  ('Inklinometr Geokon 6350',      'inklinometr',   'GEO_BB', false, (now() - interval '11 months')::timestamptz, 1, 'Sonda pionowa'),
  ('Inklinometr RST DigiTilt',     'inklinometr',   'GEO_OM', true,  (now() - interval '2 months')::timestamptz,  2, 'Zestaw z rejestratorem'),
  ('Inklinometr Sisgeo S243',      'inklinometr',   'GEO_LD', false, NULL::timestamptz,                           NULL::int, 'Nowy, przed pierwszą kalibracją'),

  -- ---------- TENSOMETRY ----------
  ('Tensometr Geokon 4000',        'tensometr',     'GEO_BB', false, (now() - interval '14 months')::timestamptz, 1, 'Strunowy, do konstrukcji stalowych'),
  ('Tensometr Geokon 4200',        'tensometr',     'GEO_OM', false, (now() - interval '5 months')::timestamptz,  1, 'Strunowy, do betonu'),
  ('Tensometr HBM LY41',           'tensometr',     'GEO_OM', false, (now() - interval '25 months')::timestamptz, 2, 'Foliowy, zestaw 10 szt.'),
  ('Tensometr Sisgeo OMD',         'tensometr',     'GEO_LD', true,  (now() - interval '1 month')::timestamptz,   1, 'Do pomiarów długotrwałych'),
  ('Tensometr Geokon 4100',        'tensometr',     'SERWIS', false, NULL,                                        NULL, 'W serwisie — uszkodzony kabel'),

  -- ---------- CZUJNIKI DRGAŃ ----------
  ('Czujnik drgań Instantel MM4',  'czujnik_drgan', 'GEO_BB', false, (now() - interval '13 months')::timestamptz, 1, 'Sejsmograf budowlany'),
  ('Czujnik drgań Syscom MR3000',  'czujnik_drgan', 'GEO_OM', false, (now() - interval '4 months')::timestamptz,  2, 'Trójosiowy'),
  ('Czujnik drgań Geosonics SSU',  'czujnik_drgan', 'GEO_LD', false, (now() - interval '10 months')::timestamptz, 1, 'Z modemem GSM'),
  ('Czujnik drgań Instantel MM5',  'czujnik_drgan', 'GEO_LD', true,  (now() - interval '30 months')::timestamptz, 2, 'Priorytet — pilna kalibracja'),
  ('Czujnik drgań Syscom MR2002',  'czujnik_drgan', 'SERWIS', false, NULL,                                        NULL, 'Diagnostyka po zalaniu'),

  -- ---------- TACHIMETRY ----------
  ('Tachimetr Leica TS16',         'tachimetr',     'GEO_BB', false, (now() - interval '3 months')::timestamptz,  1, 'Robotyczny, 1"'),
  ('Tachimetr Trimble S7',         'tachimetr',     'GEO_OM', false, (now() - interval '16 months')::timestamptz, 1, 'Z oprogramowaniem Access'),
  ('Tachimetr Topcon GT-1200',     'tachimetr',     'GEO_LD', false, (now() - interval '6 months')::timestamptz,  2, 'Zestaw z tyczką'),

  -- ---------- POCHYŁOMIERZE ----------
  ('Pochyłomierz Leica Nivel210',  'pochylomierz',  'GEO_BB', false, (now() - interval '9 months')::timestamptz,  1, 'Precyzyjny, dwuosiowy'),
  ('Pochyłomierz Sisgeo Tilt-01',  'pochylomierz',  'GEO_OM', false, (now() - interval '23 months')::timestamptz, 2, 'Do monitoringu ciągłego'),
  ('Pochyłomierz Geokon 6160',     'pochylomierz',  'SERWIS', false, NULL,                                        NULL, 'Wymiana czujnika')
) AS v(name, status, warehouse, priority, last_cal, interval_years, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM assets a WHERE a.name = v.name
);

-- Podsumowanie po imporcie
SELECT status AS rodzaj, warehouse AS magazyn, count(*) AS sztuk
FROM assets
WHERE in_storage = true
GROUP BY status, warehouse
ORDER BY rodzaj, magazyn;
