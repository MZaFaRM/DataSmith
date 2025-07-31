from functools import wraps

from pydantic import BaseModel


def cap_numeric(value: float, precision: int | None, scale: int | None) -> float:
    if precision is None:
        return value

    scale = scale or 0
    if scale > precision:
        raise ValueError(
            f"Invalid SQL definition: scale ({scale}) > precision ({precision})"
        )

    max_whole_digits = precision - scale
    if scale > 0:
        max_value = float(f"{'9' * max_whole_digits}.{ '9' * scale }")
    else:
        max_value = float(f"{'9' * max_whole_digits}")

    min_value = -max_value
    return max(min(value, max_value), min_value)


def cap_string(value: str, length: int | None) -> str:
    if length is not None:
        return value[:length]
    return value


def requires(*required_keys: str | type[BaseModel], connected: bool = False):
    def decorator(func):
        @wraps(func)
        def wrapper(self, body: dict | None = None):
            if connected and not hasattr(self.dbf, "_id"):
                return self._err("Request requires connection to a database.")

            missing = []
            fields = []
            for field in required_keys:
                if isinstance(field, type) and issubclass(field, BaseModel):
                    fields.extend(
                        name
                        for name, f in field.model_fields.items()
                        if f.is_required()
                    )
                else:
                    fields.append(field)

            if isinstance(body, dict):
                missing = [key for key in fields if key not in body]
            elif fields:
                missing = fields

            if missing:
                msg = (
                    f"Missing required parameter: {missing[0]}"
                    if len(missing) == 1
                    else f"Missing required parameters: {', '.join(missing[:-1])}, and {missing[-1]}"
                )
                return self._err(msg)
            else:
                return func(self, body)

        return wrapper

    return decorator
