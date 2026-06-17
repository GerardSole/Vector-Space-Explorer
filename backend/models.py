from pydantic import BaseModel, Field


class EmbedRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=500)


class EmbedResponse(BaseModel):
    embedding: list[float]


class InsertRequest(BaseModel):
    word: str = Field(..., min_length=1, max_length=100)
    category: str = Field(..., min_length=1, max_length=50)


class InsertResponse(BaseModel):
    word: str
    category: str
    vector: list[float]
    id: int


class VectorEntry(BaseModel):
    id: int
    word: str
    category: str
    vector: list[float]


class ListResponse(BaseModel):
    vectors: list[VectorEntry]
    count: int


class DeleteResponse(BaseModel):
    word: str
    deleted: bool


class SearchRequest(BaseModel):
    word: str = Field(..., min_length=1, max_length=100)
    limit: int = Field(5, ge=1, le=20)


class SearchResult(BaseModel):
    word: str
    category: str
    score: float
    vector: list[float]


class SearchResponse(BaseModel):
    query: str
    results: list[SearchResult]
