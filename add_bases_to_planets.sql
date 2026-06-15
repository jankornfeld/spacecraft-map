-- Add bases column to planets if it doesn't exist already
ALTER TABLE planets ADD COLUMN IF NOT EXISTS bases JSONB DEFAULT '[]'::jsonb;
