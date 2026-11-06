"""Database models (SQLAlchemy 2). SQLite by default; set DATABASE_URL for PostgreSQL."""

from __future__ import annotations

import secrets
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, scoped_session, sessionmaker

from .config import settings


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def new_id() -> str:
    return secrets.token_hex(12)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(80))
    phone: Mapped[str | None] = mapped_column(String(20))
    birth_date: Mapped[datetime | None] = mapped_column(DateTime)  # required at signup; must be 18+
    terms_accepted_at: Mapped[datetime | None] = mapped_column(DateTime)
    role: Mapped[str] = mapped_column(String(10), default="USER")  # USER | ADMIN
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    subscriptions: Mapped[list[Subscription]] = relationship(back_populates="user", cascade="all, delete-orphan")
    payments: Mapped[list[Payment]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Subscription(Base):
    __tablename__ = "subscriptions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    plan: Mapped[str] = mapped_column(String(10))  # STARTER | PRO | ELITE
    status: Mapped[str] = mapped_column(String(12), default="ACTIVE")  # ACTIVE | SUPERSEDED
    source: Mapped[str] = mapped_column(String(12), default="PAYMENT")  # PAYMENT | ADMIN_GRANT
    starts_at: Mapped[datetime] = mapped_column(DateTime)
    ends_at: Mapped[datetime] = mapped_column(DateTime)
    payment_id: Mapped[str | None] = mapped_column(ForeignKey("payments.id"), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    user: Mapped[User] = relationship(back_populates="subscriptions")
    __table_args__ = (Index("ix_sub_user_end", "user_id", "ends_at"),)


class Payment(Base):
    __tablename__ = "payments"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    plan: Mapped[str] = mapped_column(String(10))
    amount_xaf: Mapped[int] = mapped_column(Integer)
    charge_amount: Mapped[str] = mapped_column(String(20))
    charge_currency: Mapped[str] = mapped_column(String(3))
    method: Mapped[str] = mapped_column(String(15))  # MOBILE_MONEY | CARD | PAYPAL
    provider: Mapped[str] = mapped_column(String(15))  # FLUTTERWAVE | PAYPAL | SANDBOX
    reference: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    provider_ref: Mapped[str | None] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(10), default="PENDING")  # PENDING | SUCCEEDED | FAILED | CANCELLED
    failure_reason: Mapped[str | None] = mapped_column(Text)
    meta: Mapped[str | None] = mapped_column(Text)  # JSON
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)

    user: Mapped[User] = relationship(back_populates="payments")


class AiUsage(Base):
    __tablename__ = "ai_usage"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Match(Base):
    __tablename__ = "matches"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    external_id: Mapped[str] = mapped_column(String(60), unique=True)
    league_key: Mapped[str] = mapped_column(String(40))
    league_name: Mapped[str] = mapped_column(String(80))
    country: Mapped[str] = mapped_column(String(40))
    kickoff: Mapped[datetime] = mapped_column(DateTime)  # naive UTC
    match_date: Mapped[str] = mapped_column(String(10), index=True)  # local date YYYY-MM-DD
    status: Mapped[str] = mapped_column(String(10))  # SCHEDULED | LIVE | FINISHED | POSTPONED | CANCELLED
    home_team: Mapped[str] = mapped_column(String(80))
    away_team: Mapped[str] = mapped_column(String(80))
    home_logo: Mapped[str | None] = mapped_column(String(255))
    away_logo: Mapped[str | None] = mapped_column(String(255))
    home_goals: Mapped[int | None] = mapped_column(Integer)  # 90-minute score
    away_goals: Mapped[int | None] = mapped_column(Integer)
    odds: Mapped[str | None] = mapped_column(Text)  # JSON
    team_stats: Mapped[str | None] = mapped_column(Text)  # JSON
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    prediction: Mapped[Prediction | None] = relationship(back_populates="match", cascade="all, delete-orphan", uselist=False)
    __table_args__ = (Index("ix_match_status_kickoff", "status", "kickoff"),)


class Prediction(Base):
    __tablename__ = "predictions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    match_id: Mapped[str] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), unique=True)
    lambda_home: Mapped[float] = mapped_column(Float)
    lambda_away: Mapped[float] = mapped_column(Float)
    markets: Mapped[str] = mapped_column(Text)  # JSON list of market dicts
    top_scores: Mapped[str] = mapped_column(Text)  # JSON
    best_market: Mapped[str] = mapped_column(String(12))
    best_prob: Mapped[float] = mapped_column(Float)
    confidence: Mapped[int] = mapped_column(Integer)
    data_quality: Mapped[str] = mapped_column(String(6))  # HIGH | MEDIUM | LOW
    meta: Mapped[str] = mapped_column(Text)  # JSON
    summary: Mapped[str] = mapped_column(Text)  # JSON {en, fr}
    ai_analysis: Mapped[str | None] = mapped_column(Text)  # JSON, optional
    ai_analyzed_at: Mapped[datetime | None] = mapped_column(DateTime)
    model_version: Mapped[str] = mapped_column(String(30))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    match: Mapped[Match] = relationship(back_populates="prediction")


class Combo(Base):
    __tablename__ = "combos"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    date: Mapped[str] = mapped_column(String(10), index=True)
    type: Mapped[str] = mapped_column(String(20))
    min_plan: Mapped[str] = mapped_column(String(10))
    kind: Mapped[str] = mapped_column(String(8))  # ACCA | SINGLES
    total_odds: Mapped[float] = mapped_column(Float)
    probability: Mapped[float] = mapped_column(Float)
    odds_estimated: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(8), default="PENDING")  # PENDING | WON | LOST | VOID | SETTLED
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    selections: Mapped[list[ComboSelection]] = relationship(
        back_populates="combo", cascade="all, delete-orphan", order_by="ComboSelection.position"
    )
    __table_args__ = (UniqueConstraint("date", "type"),)


class ComboSelection(Base):
    __tablename__ = "combo_selections"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    combo_id: Mapped[str] = mapped_column(ForeignKey("combos.id", ondelete="CASCADE"))
    match_id: Mapped[str] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    market: Mapped[str] = mapped_column(String(12))
    odds: Mapped[float] = mapped_column(Float)
    probability: Mapped[float] = mapped_column(Float)
    odds_estimated: Mapped[bool] = mapped_column(Boolean, default=False)
    result: Mapped[str] = mapped_column(String(8), default="PENDING")  # PENDING | WON | LOST | VOID
    position: Mapped[int] = mapped_column(Integer)

    combo: Mapped[Combo] = relationship(back_populates="selections")
    match: Mapped[Match] = relationship()


class Feedback(Base):
    """Tester feedback collected through the in-app form (beta test version)."""

    __tablename__ = "feedback"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    name: Mapped[str | None] = mapped_column(String(80))
    contact: Mapped[str | None] = mapped_column(String(120))  # email or WhatsApp, optional
    rating: Mapped[int] = mapped_column(Integer)  # 1–5
    category: Mapped[str] = mapped_column(String(20))
    message: Mapped[str] = mapped_column(Text)
    page: Mapped[str | None] = mapped_column(String(255))
    lang: Mapped[str] = mapped_column(String(2))
    device: Mapped[str | None] = mapped_column(String(255))  # browser user agent
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class JobRun(Base):
    __tablename__ = "job_runs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(30))
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)
    ok: Mapped[bool | None] = mapped_column(Boolean)
    detail: Mapped[str | None] = mapped_column(Text)


engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {},
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)
#: Thread-local session used by web requests and background jobs.
db = scoped_session(SessionLocal)


def init_db() -> None:
    Base.metadata.create_all(engine)
