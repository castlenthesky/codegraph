"""
API layer for the test application.
Provides HTTP-like endpoint handlers that delegate to the service layer.
"""

from typing import Dict, Any, List, Optional
from services.item_service import (
    ItemService,
    ItemValidationError,
    ItemNotFoundError
)


class APIResponse:
    """Represents an API response."""

    def __init__(self, status_code: int, data: Any = None, error: Optional[str] = None):
        """
        Initialize an API response.

        Args:
            status_code: HTTP status code
            data: Response data
            error: Error message if applicable
        """
        self.status_code = status_code
        self.data = data
        self.error = error

    def to_dict(self) -> Dict[str, Any]:
        """Convert response to dictionary."""
        response = {"status_code": self.status_code}

        if self.data is not None:
            response["data"] = self.data

        if self.error is not None:
            response["error"] = self.error

        return response

    def __repr__(self) -> str:
        return f"APIResponse(status_code={self.status_code}, data={self.data}, error={self.error})"


class ItemAPI:
    """API handlers for item management endpoints."""

    def __init__(self, item_service: ItemService):
        """
        Initialize the API with an item service.

        Args:
            item_service: ItemService instance for business logic
        """
        self.service = item_service

    def get_items(self) -> APIResponse:
        """
        GET /items - Retrieve all items.

        Returns:
            APIResponse with list of items
        """
        try:
            items = self.service.get_all_items()
            return APIResponse(200, data={"items": items, "count": len(items)})
        except Exception as e:
            return APIResponse(500, error=f"Internal server error: {str(e)}")

    def get_item(self, item_id: int) -> APIResponse:
        """
        GET /items/:id - Retrieve a specific item.

        Args:
            item_id: The ID of the item to retrieve

        Returns:
            APIResponse with item data or error
        """
        try:
            item = self.service.get_item(item_id)
            return APIResponse(200, data={"item": item})
        except ItemNotFoundError as e:
            return APIResponse(404, error=str(e))
        except Exception as e:
            return APIResponse(500, error=f"Internal server error: {str(e)}")

    def create_item(self, payload: Dict[str, Any]) -> APIResponse:
        """
        POST /items - Create a new item.

        Args:
            payload: Dictionary containing item data (name, description, quantity)

        Returns:
            APIResponse with created item or error
        """
        try:
            # Extract and validate payload
            name = payload.get("name")
            if not name:
                return APIResponse(400, error="Missing required field: name")

            description = payload.get("description")
            quantity = payload.get("quantity", 0)

            # Validate quantity type
            if not isinstance(quantity, int):
                return APIResponse(400, error="Quantity must be an integer")

            # Create item through service
            item = self.service.create_item(name, description, quantity)
            return APIResponse(201, data={"item": item})

        except ItemValidationError as e:
            return APIResponse(400, error=str(e))
        except Exception as e:
            return APIResponse(500, error=f"Internal server error: {str(e)}")

    def update_item(self, item_id: int, payload: Dict[str, Any]) -> APIResponse:
        """
        PUT /items/:id - Update an existing item.

        Args:
            item_id: The ID of the item to update
            payload: Dictionary containing fields to update

        Returns:
            APIResponse with updated item or error
        """
        try:
            # Extract fields from payload
            name = payload.get("name")
            description = payload.get("description")
            quantity = payload.get("quantity")

            # Validate quantity type if provided
            if quantity is not None and not isinstance(quantity, int):
                return APIResponse(400, error="Quantity must be an integer")

            # Update item through service
            item = self.service.update_item(item_id, name, description, quantity)
            return APIResponse(200, data={"item": item})

        except ItemNotFoundError as e:
            return APIResponse(404, error=str(e))
        except ItemValidationError as e:
            return APIResponse(400, error=str(e))
        except Exception as e:
            return APIResponse(500, error=f"Internal server error: {str(e)}")

    def delete_item(self, item_id: int) -> APIResponse:
        """
        DELETE /items/:id - Delete an item.

        Args:
            item_id: The ID of the item to delete

        Returns:
            APIResponse indicating success or error
        """
        try:
            self.service.delete_item(item_id)
            return APIResponse(204, data={"message": "Item deleted successfully"})
        except ItemNotFoundError as e:
            return APIResponse(404, error=str(e))
        except Exception as e:
            return APIResponse(500, error=f"Internal server error: {str(e)}")

    def get_low_stock_items(self, threshold: Optional[int] = None) -> APIResponse:
        """
        GET /items/low-stock - Get items with low stock.

        Args:
            threshold: Optional quantity threshold (query parameter)

        Returns:
            APIResponse with list of low stock items
        """
        try:
            # Use default threshold if not provided
            if threshold is None:
                threshold = 10

            # Validate threshold
            if not isinstance(threshold, int) or threshold < 0:
                return APIResponse(400, error="Threshold must be a non-negative integer")

            items = self.service.get_low_stock_items(threshold)
            return APIResponse(200, data={
                "items": items,
                "count": len(items),
                "threshold": threshold
            })
        except Exception as e:
            return APIResponse(500, error=f"Internal server error: {str(e)}")

    def increase_item_quantity(self, item_id: int, payload: Dict[str, Any]) -> APIResponse:
        """
        POST /items/:id/increase - Increase item quantity.

        Args:
            item_id: The ID of the item
            payload: Dictionary containing amount to increase

        Returns:
            APIResponse with updated item or error
        """
        try:
            amount = payload.get("amount")
            if amount is None:
                return APIResponse(400, error="Missing required field: amount")

            if not isinstance(amount, int):
                return APIResponse(400, error="Amount must be an integer")

            item = self.service.increase_quantity(item_id, amount)
            return APIResponse(200, data={"item": item})

        except ItemNotFoundError as e:
            return APIResponse(404, error=str(e))
        except ItemValidationError as e:
            return APIResponse(400, error=str(e))
        except Exception as e:
            return APIResponse(500, error=f"Internal server error: {str(e)}")

    def decrease_item_quantity(self, item_id: int, payload: Dict[str, Any]) -> APIResponse:
        """
        POST /items/:id/decrease - Decrease item quantity.

        Args:
            item_id: The ID of the item
            payload: Dictionary containing amount to decrease

        Returns:
            APIResponse with updated item or error
        """
        try:
            amount = payload.get("amount")
            if amount is None:
                return APIResponse(400, error="Missing required field: amount")

            if not isinstance(amount, int):
                return APIResponse(400, error="Amount must be an integer")

            item = self.service.decrease_quantity(item_id, amount)
            return APIResponse(200, data={"item": item})

        except ItemNotFoundError as e:
            return APIResponse(404, error=str(e))
        except ItemValidationError as e:
            return APIResponse(400, error=str(e))
        except Exception as e:
            return APIResponse(500, error=f"Internal server error: {str(e)}")
