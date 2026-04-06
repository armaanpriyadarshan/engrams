from typing import Dict, Type
from integrations.base import Integration

_registry: Dict[str, Type[Integration]] = {}


def register(cls: Type[Integration]) -> Type[Integration]:
    _registry[cls.service_name] = cls
    return cls


def get_integration(service_name: str) -> Integration:
    cls = _registry.get(service_name)
    if not cls:
        raise ValueError(f"Unknown integration: {service_name}")
    return cls()


def list_services() -> list:
    return [
        {
            "service_name": cls.service_name,
            "display_name": cls.display_name,
            "description": cls.description,
        }
        for cls in _registry.values()
    ]
