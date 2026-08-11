--
-- PostgreSQL database dump
--

\restrict lSI7QV0Z2qc3nUcJn2uIamUR3tpE0pUjqLiKL33j3wGQlrgkijMBdQsFG5SEScP

-- Dumped from database version 18.4
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: designations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.designations (
    id integer NOT NULL,
    title character varying(50)
);


--
-- Name: designations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.designations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: designations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.designations_id_seq OWNED BY public.designations.id;


--
-- Name: expense_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expense_categories (
    category_id integer NOT NULL,
    category_name character varying(50)
);


--
-- Name: expense_categories_category_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.expense_categories_category_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: expense_categories_category_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.expense_categories_category_id_seq OWNED BY public.expense_categories.category_id;


--
-- Name: expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expenses (
    expense_id integer NOT NULL,
    category_id integer,
    amount numeric(12,2) NOT NULL,
    description text,
    created_at date DEFAULT CURRENT_DATE
);


--
-- Name: expenses_expense_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.expenses_expense_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: expenses_expense_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.expenses_expense_id_seq OWNED BY public.expenses.expense_id;


--
-- Name: fee_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fee_payments (
    payment_id integer NOT NULL,
    student_id integer,
    academic_month date NOT NULL,
    amount_due numeric(10,2),
    amount_paid numeric(10,2) DEFAULT 0,
    payment_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: fee_payments_payment_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fee_payments_payment_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fee_payments_payment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fee_payments_payment_id_seq OWNED BY public.fee_payments.payment_id;


--
-- Name: left_staff; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.left_staff (
    left_staff_id integer NOT NULL,
    old_staff_id integer,
    name character varying NOT NULL,
    cnic character varying,
    phone_no character varying,
    salary numeric,
    designation_id integer,
    designation character varying,
    left_date date DEFAULT CURRENT_DATE NOT NULL,
    left_reason text
);


--
-- Name: left_staff_left_staff_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.left_staff_left_staff_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: left_staff_left_staff_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.left_staff_left_staff_id_seq OWNED BY public.left_staff.left_staff_id;


--
-- Name: left_student_fee_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.left_student_fee_payments (
    left_fee_payment_id integer NOT NULL,
    left_student_id integer NOT NULL,
    old_student_id integer,
    academic_month date,
    amount_due numeric,
    amount_paid numeric,
    payment_date timestamp without time zone
);


--
-- Name: left_student_fee_payments_left_fee_payment_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.left_student_fee_payments_left_fee_payment_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: left_student_fee_payments_left_fee_payment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.left_student_fee_payments_left_fee_payment_id_seq OWNED BY public.left_student_fee_payments.left_fee_payment_id;


--
-- Name: left_students; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.left_students (
    left_student_id integer NOT NULL,
    old_student_id integer,
    roll_no integer,
    section character varying,
    class character varying,
    first_name character varying NOT NULL,
    last_name character varying,
    father_name character varying,
    contact_1 character varying,
    contact_2 character varying,
    email character varying,
    photo_url text,
    address text,
    admission_date date,
    left_date date DEFAULT CURRENT_DATE NOT NULL,
    left_reason text,
    fee_start_month date,
    gender character varying(10),
    CONSTRAINT left_students_gender_check CHECK (((gender IS NULL) OR ((gender)::text = ANY ((ARRAY['male'::character varying, 'female'::character varying])::text[]))))
);


--
-- Name: left_students_left_student_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.left_students_left_student_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: left_students_left_student_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.left_students_left_student_id_seq OWNED BY public.left_students.left_student_id;


--
-- Name: payment_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_receipts (
    receipt_no integer NOT NULL,
    payment_id integer NOT NULL,
    student_id integer NOT NULL,
    roll_no character varying,
    student_name character varying,
    class character varying,
    section character varying,
    academic_month date,
    amount_due numeric DEFAULT 0,
    amount_paid numeric DEFAULT 0,
    print_mode character varying DEFAULT 'paper'::character varying,
    issued_at timestamp without time zone DEFAULT now() NOT NULL,
    issued_by character varying
);


--
-- Name: payment_receipts_receipt_no_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payment_receipts_receipt_no_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payment_receipts_receipt_no_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payment_receipts_receipt_no_seq OWNED BY public.payment_receipts.receipt_no;


--
-- Name: role_page_visibility; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_page_visibility (
    role_name character varying NOT NULL,
    page_key character varying NOT NULL,
    visible boolean DEFAULT true NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions (
    role_name character varying NOT NULL,
    permission_key character varying NOT NULL,
    allowed boolean DEFAULT false NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    role_id integer NOT NULL,
    role_name character varying(20) NOT NULL
);


--
-- Name: roles_role_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.roles_role_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: roles_role_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.roles_role_id_seq OWNED BY public.roles.role_id;


--
-- Name: staff; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff (
    staff_id integer NOT NULL,
    name character varying(100) NOT NULL,
    cnic character varying(15) NOT NULL,
    phone_no character varying(15),
    salary numeric(12,2),
    designation_id integer
);


--
-- Name: staff_staff_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.staff_staff_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: staff_staff_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.staff_staff_id_seq OWNED BY public.staff.staff_id;


--
-- Name: students; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.students (
    student_id integer NOT NULL,
    roll_no integer NOT NULL,
    section character varying(10) NOT NULL,
    class character varying(10) NOT NULL,
    first_name character varying(50) NOT NULL,
    last_name character varying(50),
    father_name character varying(100),
    contact_1 character varying(15),
    contact_2 character varying(15),
    address text,
    admission_date date DEFAULT CURRENT_DATE NOT NULL,
    email character varying(255),
    photo_url text,
    fee_start_month date,
    gender character varying(10),
    CONSTRAINT students_gender_check CHECK (((gender IS NULL) OR ((gender)::text = ANY ((ARRAY['male'::character varying, 'female'::character varying])::text[]))))
);


--
-- Name: students_student_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.students_student_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: students_student_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.students_student_id_seq OWNED BY public.students.student_id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    user_id integer NOT NULL,
    username character varying(50) NOT NULL,
    password_hash character varying(255) NOT NULL,
    role_id integer,
    staff_id integer,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    last_login timestamp without time zone
);


--
-- Name: users_user_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_user_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_user_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_user_id_seq OWNED BY public.users.user_id;


--
-- Name: designations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.designations ALTER COLUMN id SET DEFAULT nextval('public.designations_id_seq'::regclass);


--
-- Name: expense_categories category_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_categories ALTER COLUMN category_id SET DEFAULT nextval('public.expense_categories_category_id_seq'::regclass);


--
-- Name: expenses expense_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses ALTER COLUMN expense_id SET DEFAULT nextval('public.expenses_expense_id_seq'::regclass);


--
-- Name: fee_payments payment_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_payments ALTER COLUMN payment_id SET DEFAULT nextval('public.fee_payments_payment_id_seq'::regclass);


--
-- Name: left_staff left_staff_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.left_staff ALTER COLUMN left_staff_id SET DEFAULT nextval('public.left_staff_left_staff_id_seq'::regclass);


--
-- Name: left_student_fee_payments left_fee_payment_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.left_student_fee_payments ALTER COLUMN left_fee_payment_id SET DEFAULT nextval('public.left_student_fee_payments_left_fee_payment_id_seq'::regclass);


--
-- Name: left_students left_student_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.left_students ALTER COLUMN left_student_id SET DEFAULT nextval('public.left_students_left_student_id_seq'::regclass);


--
-- Name: payment_receipts receipt_no; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_receipts ALTER COLUMN receipt_no SET DEFAULT nextval('public.payment_receipts_receipt_no_seq'::regclass);


--
-- Name: roles role_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles ALTER COLUMN role_id SET DEFAULT nextval('public.roles_role_id_seq'::regclass);


--
-- Name: staff staff_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff ALTER COLUMN staff_id SET DEFAULT nextval('public.staff_staff_id_seq'::regclass);


--
-- Name: students student_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students ALTER COLUMN student_id SET DEFAULT nextval('public.students_student_id_seq'::regclass);


--
-- Name: users user_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN user_id SET DEFAULT nextval('public.users_user_id_seq'::regclass);


--
-- Name: designations designations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.designations
    ADD CONSTRAINT designations_pkey PRIMARY KEY (id);


--
-- Name: expense_categories expense_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_categories
    ADD CONSTRAINT expense_categories_pkey PRIMARY KEY (category_id);


--
-- Name: expenses expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (expense_id);


--
-- Name: fee_payments fee_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_payments
    ADD CONSTRAINT fee_payments_pkey PRIMARY KEY (payment_id);


--
-- Name: left_staff left_staff_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.left_staff
    ADD CONSTRAINT left_staff_pkey PRIMARY KEY (left_staff_id);


--
-- Name: left_student_fee_payments left_student_fee_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.left_student_fee_payments
    ADD CONSTRAINT left_student_fee_payments_pkey PRIMARY KEY (left_fee_payment_id);


--
-- Name: left_students left_students_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.left_students
    ADD CONSTRAINT left_students_pkey PRIMARY KEY (left_student_id);


--
-- Name: payment_receipts payment_receipts_payment_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_receipts
    ADD CONSTRAINT payment_receipts_payment_id_unique UNIQUE (payment_id);


--
-- Name: payment_receipts payment_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_receipts
    ADD CONSTRAINT payment_receipts_pkey PRIMARY KEY (receipt_no);


--
-- Name: role_page_visibility role_page_visibility_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_page_visibility
    ADD CONSTRAINT role_page_visibility_pkey PRIMARY KEY (role_name, page_key);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (role_name, permission_key);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (role_id);


--
-- Name: roles roles_role_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_role_name_key UNIQUE (role_name);


--
-- Name: staff staff_cnic_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_cnic_key UNIQUE (cnic);


--
-- Name: staff staff_cnic_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_cnic_unique UNIQUE (cnic);


--
-- Name: staff staff_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_pkey PRIMARY KEY (staff_id);


--
-- Name: students students_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_pkey PRIMARY KEY (student_id);


--
-- Name: students students_roll_no_section_class_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_roll_no_section_class_key UNIQUE (roll_no, section, class);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- Name: users users_staff_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_staff_id_key UNIQUE (staff_id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: idx_payment_receipts_issued_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_receipts_issued_at ON public.payment_receipts USING btree (issued_at);


--
-- Name: idx_payment_receipts_student_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_receipts_student_id ON public.payment_receipts USING btree (student_id);


--
-- Name: students_class_section_gender_roll_no_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX students_class_section_gender_roll_no_unique ON public.students USING btree (class, section, COALESCE(gender, 'unspecified'::character varying), roll_no);


--
-- Name: expenses expenses_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.expense_categories(category_id);


--
-- Name: fee_payments fee_payments_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_payments
    ADD CONSTRAINT fee_payments_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(student_id);


--
-- Name: left_student_fee_payments left_student_fee_payments_left_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.left_student_fee_payments
    ADD CONSTRAINT left_student_fee_payments_left_student_id_fkey FOREIGN KEY (left_student_id) REFERENCES public.left_students(left_student_id) ON DELETE CASCADE;


--
-- Name: payment_receipts payment_receipts_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_receipts
    ADD CONSTRAINT payment_receipts_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.fee_payments(payment_id) ON DELETE CASCADE;


--
-- Name: staff staff_designation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_designation_id_fkey FOREIGN KEY (designation_id) REFERENCES public.designations(id);


--
-- Name: users users_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(role_id);


--
-- Name: users users_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(staff_id);


--
-- PostgreSQL database dump complete
--

\unrestrict lSI7QV0Z2qc3nUcJn2uIamUR3tpE0pUjqLiKL33j3wGQlrgkijMBdQsFG5SEScP

