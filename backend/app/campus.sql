-- A new board; preserve all existing boards, posts, and analysis results.
INSERT INTO events (id, title, category, description, location, starts_at, is_benchmark)
VALUES (
    'campus-community', 'Campus', 'CAMPUS / COMMUNITY',
    'Share everyday campus life, student resources, helpful tips, and ideas for a better Georgetown community.',
    'Georgetown Campus', now(), false
)
ON CONFLICT (id) DO NOTHING;
