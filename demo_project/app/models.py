class Entity:
    pass

class User(Entity):
    @classmethod
    def from_payload(cls, payload: dict):
        return cls()
