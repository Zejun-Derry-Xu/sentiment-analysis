"""Password storage and explicit provisioning for the course demo."""

import hashlib
import secrets
from uuid import uuid4

DEMO_ACCOUNTS = {"admin": "admin", "student1": "student", "student2": "student"}


def password_hash(password, salt=None):
    salt = secrets.token_hex(16) if salt is None else salt
    digest = hashlib.scrypt(
        password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1
    )
    return f"{salt}:{digest.hex()}"


def verify_password(password, stored):
    salt = stored.split(":", 1)[0] if stored else "00" * 16
    candidate = password_hash(password, salt)
    return secrets.compare_digest(candidate, stored or "")


def create_account(c, username, password, role="student"):
    return c.execute(
        """INSERT INTO users(id,username,role,login_name,password_hash)
        VALUES (%s,%s,%s,%s,%s) ON CONFLICT(login_name) DO NOTHING
        RETURNING id,username,role""",
        (uuid4(), username, role, username.casefold(), password_hash(password)),
    ).fetchone()
