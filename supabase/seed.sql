-- ============================================================
-- SiteSketch - seed data (matches static/js/api.js)
-- Run after schema.sql. Idempotent.
-- ============================================================

-- ---------- website types ----------
insert into website_types (id, name, description, icon, sort_order) values
  ('business',   'Business',      'Services, trust, and contact for a company',        'briefcase',   1),
  ('portfolio',  'Portfolio',     'Show your work and get noticed',                    'easel',       2),
  ('restaurant', 'Restaurant',    'Menu, hours, and location',                         'cup-hot',     3),
  ('store',      'Online Store',  'Products, launches, and sales',                    'shop',        4),
  ('school',     'School Project','Class info, events, and signups',                   'mortarboard', 5),
  ('blog',       'Blog',          'Articles, updates, and readers',                   'journal-text',6)
on conflict (id) do update
  set name = excluded.name,
      description = excluded.description,
      icon = excluded.icon,
      sort_order = excluded.sort_order;

-- ---------- goals ----------
insert into goals (id, type_id, name, sort_order) values
  ('get-contact',      'business',   'Get contacted by customers',  1),
  ('show-services',    'business',   'Show my services',           2),
  ('build-trust',      'business',   'Build trust with visitors',   3),
  ('showcase-work',    'portfolio',  'Showcase my work',           1),
  ('get-hired',        'portfolio',  'Get hired or find clients',   2),
  ('take-reservations','restaurant', 'Take reservations',          1),
  ('show-menu',        'restaurant', 'Show the menu',              2),
  ('find-location',    'restaurant', 'Help people find us',        3),
  ('sell-products',    'store',      'Sell products',              1),
  ('announce-launch',  'store',      'Announce a launch',          2),
  ('share-info',       'school',     'Share project information',  1),
  ('collect-signups',  'school',     'Collect signups',            2),
  ('publish-articles', 'blog',       'Publish articles',           1),
  ('grow-readers',     'blog',       'Grow my readers',            2)
on conflict (id) do update
  set name = excluded.name,
      sort_order = excluded.sort_order;

-- ---------- section templates ----------
-- default_json carries the section's seed copy; checklist_items is the
-- optional "what to prepare" list (empty unless you want it in the UI).
insert into section_templates (id, type_id, section_type, name, sort_order, default_json, checklist_items) values
  ('business.hero',         'business', 'hero',         'Hero',               1, '{"subtitle":"What you do, for whom, and how to reach you"}', '[]'),
  ('business.about',        'business', 'about',        'About',              2, '{"subtitle":"Who you are and what you do"}',                  '[]'),
  ('business.features',     'business', 'features',     'What you offer',     3, '{"subtitle":"Your services, in tidy blocks"}',             '[]'),
  ('business.testimonials', 'business', 'testimonials', 'Testimonials',       4, '{"subtitle":"What clients say about working with you"}',    '[]'),
  ('business.cta',          'business', 'cta',          'Call to action',     5, '{"subtitle":"One clear next step"}',                       '[]'),
  ('business.contact',      'business', 'contact',      'Contact',            6, '{"subtitle":"How people can reach you"}',                   '[]'),

  ('portfolio.hero',        'portfolio','hero',         'Hero',               1, '{"subtitle":"What you make and where it is going"}',       '[]'),
  ('portfolio.about',       'portfolio','about',        'About',              2, '{"subtitle":"Your background and how you work"}',          '[]'),
  ('portfolio.gallery',     'portfolio','gallery',      'Selected work',      3, '{"subtitle":"Projects worth opening first"}',              '[]'),
  ('portfolio.testimonials','portfolio','testimonials', 'Recommendations',    4, '{"subtitle":"What collaborators say"}',                   '[]'),
  ('portfolio.contact',     'portfolio','contact',      'Get in touch',       5, '{"subtitle":"Where to find you online"}',                 '[]'),

  ('restaurant.hero',       'restaurant','hero',        'Hero',               1, '{"subtitle":"What you serve, and why people come back"}',  '[]'),
  ('restaurant.menu',       'restaurant','menu',        'Menu highlights',    2, '{"subtitle":"Customer favorites"}',                       '[]'),
  ('restaurant.about',      'restaurant','about',       'Our story',          3, '{"subtitle":"How the kitchen started"}',                  '[]'),
  ('restaurant.hours',      'restaurant','hours',       'Hours & location',   4, '{"subtitle":"When to visit"}',                            '[]'),
  ('restaurant.gallery',    'restaurant','gallery',     'Food & place',       5, '{"subtitle":"The room and the dishes"}',                   '[]'),
  ('restaurant.contact',    'restaurant','contact',     'Reservations',       6, '{"subtitle":"Book a table or ask anything"}',              '[]'),

  ('store.hero',            'store',     'hero',        'Hero',               1, '{"subtitle":"What you sell, and why it is worth it"}',    '[]'),
  ('store.products',        'store',     'products',    'Products',           2, '{"subtitle":"Your best sellers"}',                        '[]'),
  ('store.features',        'store',     'features',    'Why buy from us',    3, '{"subtitle":"Shipping, returns, guarantees"}',            '[]'),
  ('store.testimonials',    'store',     'testimonials','Reviews',            4, '{"subtitle":"What buyers say"}',                          '[]'),
  ('store.cta',             'store',     'cta',         'Announce',           5, '{"subtitle":"New arrivals and restocks"}',                '[]'),
  ('store.contact',         'store',     'contact',     'Contact',            6, '{"subtitle":"Questions about an order"}',                 '[]'),

  ('school.hero',           'school',    'hero',        'Hero',               1, '{"subtitle":"What the project is about"}',                '[]'),
  ('school.about',          'school',    'about',       'About',              2, '{"subtitle":"Who is behind it"}',                         '[]'),
  ('school.gallery',        'school',    'gallery',     'Gallery',            3, '{"subtitle":"Photos and screenshots"}',                  '[]'),
  ('school.faq',            'school',    'faq',         'FAQ',                4, '{"subtitle":"Questions people usually ask"}',             '[]'),
  ('school.contact',        'school',    'contact',     'Contact',            5, '{"subtitle":"Ask about the project"}',                    '[]'),

  ('blog.hero',             'blog',      'hero',        'Hero',               1, '{"subtitle":"What you write about"}',                      '[]'),
  ('blog.blog',             'blog',      'blog',        'Latest posts',       2, '{"subtitle":"Recent writing"}',                           '[]'),
  ('blog.about',            'blog',      'about',       'About',              3, '{"subtitle":"Who is writing and why"}',                   '[]'),
  ('blog.newsletter',       'blog',      'newsletter',  'Newsletter',         4, '{"subtitle":"What subscribers get"}',                     '[]'),
  ('blog.contact',          'blog',      'contact',     'Contact',            5, '{"subtitle":"Where to find the author"}',                 '[]')
on conflict (id) do update
  set name = excluded.name,
      sort_order = excluded.sort_order,
      default_json = excluded.default_json;