"""
Modeles Pydantic partages par les routers de l'API Novlearn.
"""
from typing import List, Optional

from pydantic import BaseModel


class FriendCodeResponse(BaseModel):
    code: str
    invite_link: str


class AddFriendByCodeRequest(BaseModel):
    code: str


class CreateDuelRequest(BaseModel):
    friend_id: str
    exercise_id: Optional[int] = None


class ChapterTestNextRequest(BaseModel):
    chapter: str
    last_success: bool


class NotificationPreferencesRequest(BaseModel):
    notif_push_duels: bool
    notif_push_daily: bool
    notif_email_duels: bool
    notif_email_daily: bool
    notif_newsletter: bool


class PushSubscribeRequest(BaseModel):
    endpoint: str
    p256dh: str
    auth: str


class PushUnsubscribeRequest(BaseModel):
    endpoint: str


class CreateDSRequest(BaseModel):
    title: str
    deadline: str
    competence_ids: List[str]


class SubmitDSAnswerRequest(BaseModel):
    exercise_id: str
    competence_ids: List[str]
    is_correct: bool
    difficulty: str
