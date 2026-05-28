-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.
-- ตัวอย่างฐานข้อมูลสำหรับแอปพลิเคชัน MakeFriends
CREATE TABLE public.activities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  image_urls ARRAY,
  start_datetime timestamp with time zone,
  duration text,
  province text,
  max_participants integer DEFAULT 2,
  category_tags ARRAY,
  creator_email text,
  created_at timestamp with time zone DEFAULT now(),
  status text DEFAULT 'upcoming'::text,
  end_datetime timestamp with time zone,
  min_age integer,
  max_age integer,
  gender_preference text,
  min_rating real,
  latitude double precision,
  longitude double precision,
  CONSTRAINT activities_pkey PRIMARY KEY (id),
  CONSTRAINT activities_creator_email_fkey FOREIGN KEY (creator_email) REFERENCES public.users(email)
);
CREATE TABLE public.activity_participants (
  activity_id uuid NOT NULL,
  user_email text NOT NULL,
  joined_at timestamp with time zone DEFAULT now(),
  CONSTRAINT activity_participants_pkey PRIMARY KEY (activity_id, user_email),
  CONSTRAINT activity_participants_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id),
  CONSTRAINT activity_participants_user_email_fkey FOREIGN KEY (user_email) REFERENCES public.users(email)
);
CREATE TABLE public.activity_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL,
  reporter_email text NOT NULL,
  report_type text NOT NULL CHECK (report_type = ANY (ARRAY['activity'::text, 'user'::text])),
  reported_user_email text,
  reason text NOT NULL,
  image_url text,
  status text NOT NULL DEFAULT 'pending'::text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT activity_reports_pkey PRIMARY KEY (id),
  CONSTRAINT activity_reports_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id),
  CONSTRAINT activity_reports_reporter_email_fkey FOREIGN KEY (reporter_email) REFERENCES public.users(email),
  CONSTRAINT activity_reports_reported_user_email_fkey FOREIGN KEY (reported_user_email) REFERENCES public.users(email)
);
CREATE TABLE public.activity_waitlists (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  activity_id uuid NOT NULL,
  user_email text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT activity_waitlists_pkey PRIMARY KEY (id),
  CONSTRAINT activity_waitlists_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id),
  CONSTRAINT activity_waitlists_user_email_fkey FOREIGN KEY (user_email) REFERENCES public.users(email)
);
CREATE TABLE public.categories (
  id integer NOT NULL DEFAULT nextval('categories_id_seq'::regclass),
  name text NOT NULL UNIQUE,
  icon_name text,
  CONSTRAINT categories_pkey PRIMARY KEY (id)
);
CREATE TABLE public.chat_reads (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_email text NOT NULL,
  chat_type text NOT NULL CHECK (chat_type = ANY (ARRAY['group'::text, 'private'::text])),
  reference_id text NOT NULL,
  last_read_at timestamp with time zone DEFAULT now(),
  CONSTRAINT chat_reads_pkey PRIMARY KEY (id)
);
CREATE TABLE public.friend_requests (
  id bigint NOT NULL DEFAULT nextval('friend_requests_id_seq'::regclass),
  sender_email text,
  receiver_email text,
  status text DEFAULT 'pending'::text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT friend_requests_pkey PRIMARY KEY (id),
  CONSTRAINT friend_requests_sender_email_fkey FOREIGN KEY (sender_email) REFERENCES public.users(email),
  CONSTRAINT friend_requests_receiver_email_fkey FOREIGN KEY (receiver_email) REFERENCES public.users(email)
);
CREATE TABLE public.friends (
  id bigint NOT NULL DEFAULT nextval('friends_id_seq'::regclass),
  user_email_1 text,
  user_email_2 text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT friends_pkey PRIMARY KEY (id),
  CONSTRAINT friends_user_email_1_fkey FOREIGN KEY (user_email_1) REFERENCES public.users(email),
  CONSTRAINT friends_user_email_2_fkey FOREIGN KEY (user_email_2) REFERENCES public.users(email)
);
CREATE TABLE public.messages (
  id integer NOT NULL DEFAULT nextval('messages_id_seq'::regclass),
  activity_id uuid,
  sender_email text,
  text text,
  is_system_message boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  image_url text,
  receiver_email text,
  chat_type text DEFAULT 'group'::text,
  CONSTRAINT messages_pkey PRIMARY KEY (id),
  CONSTRAINT messages_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id),
  CONSTRAINT messages_sender_email_fkey FOREIGN KEY (sender_email) REFERENCES public.users(email),
  CONSTRAINT messages_receiver_email_fkey FOREIGN KEY (receiver_email) REFERENCES public.users(email)
);
CREATE TABLE public.notifications (
  id integer NOT NULL DEFAULT nextval('notifications_id_seq'::regclass),
  user_email text,
  title text,
  message text,
  activity_id uuid,
  type text,
  is_read boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  friend_request_id bigint,
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_user_email_fkey FOREIGN KEY (user_email) REFERENCES public.users(email),
  CONSTRAINT notifications_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id)
);
CREATE TABLE public.reviews (
  id integer NOT NULL DEFAULT nextval('reviews_id_seq'::regclass),
  activity_id uuid,
  reviewer_email text,
  reviewee_email text,
  rating integer CHECK (rating >= 1 AND rating <= 5),
  comment text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT reviews_pkey PRIMARY KEY (id),
  CONSTRAINT reviews_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id),
  CONSTRAINT reviews_reviewer_email_fkey FOREIGN KEY (reviewer_email) REFERENCES public.users(email),
  CONSTRAINT reviews_reviewee_email_fkey FOREIGN KEY (reviewee_email) REFERENCES public.users(email)
);
CREATE TABLE public.users (
  email text NOT NULL,
  password text NOT NULL,
  name text,
  phone text,
  dob date,
  profile_image text,
  created_at timestamp with time zone DEFAULT now(),
  bio text,
  university text,
  gender text,
  interests ARRAY DEFAULT '{}'::text[],
  rating numeric DEFAULT 0,
  role text DEFAULT 'user'::text,
  banned_until timestamp with time zone,
  reset_otp text,
  CONSTRAINT users_pkey PRIMARY KEY (email)
);