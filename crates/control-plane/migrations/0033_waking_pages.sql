CREATE TABLE service_waking_pages (
 service_id uuid PRIMARY KEY REFERENCES services(id),
 version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 html text CHECK(html IS NULL OR octet_length(html) BETWEEN 1 AND 131072)
);
CREATE TABLE waking_page_operations (
 operation_id uuid PRIMARY KEY,
 service_id uuid NOT NULL REFERENCES services(id),
 expected_version integer NOT NULL,
 content_hash text NOT NULL
);
