"""
Service layer for item management.
Provides business logic and validation between API and database layers.
"""

from typing import List, Optional, Dict, Any
from database.db import Database


class ItemValidationError(Exception):
    """Exception raised when item validation fails."""
    pass


class ItemNotFoundError(Exception):
    """Exception raised when an item is not found."""
    pass


class ItemService:
    """Service for managing items with business logic and validation."""

    def __init__(self, database: Database):
        """
        Initialize the item service.

        Args:
            database: Database instance to use for persistence
        """
        self.db = database

    def validate_item_name(self, name: str) -> None:
        """
        Validate item name.

        Args:
            name: The item name to validate

        Raises:
            ItemValidationError: If the name is invalid
        """
        if not name or not name.strip():
            raise ItemValidationError("Item name cannot be empty")

        if len(name) > 100:
            raise ItemValidationError("Item name cannot exceed 100 characters")

    def validate_quantity(self, quantity: int) -> None:
        """
        Validate item quantity.

        Args:
            quantity: The quantity to validate

        Raises:
            ItemValidationError: If the quantity is invalid
        """
        if quantity < 0:
            raise ItemValidationError("Item quantity cannot be negative")

        if quantity > 1000000:
            raise ItemValidationError("Item quantity cannot exceed 1,000,000")

    def create_item(self, name: str, description: Optional[str] = None,
                    quantity: int = 0) -> Dict[str, Any]:
        """
        Create a new item with validation.

        Args:
            name: Name of the item
            description: Optional description
            quantity: Initial quantity (default: 0)

        Returns:
            Dictionary containing the created item data

        Raises:
            ItemValidationError: If validation fails
        """
        # Validate inputs
        self.validate_item_name(name)
        self.validate_quantity(quantity)

        # Sanitize name
        sanitized_name = name.strip()

        # Create item in database
        item_id = self.db.insert_item(sanitized_name, description, quantity)

        # Retrieve and return the created item
        item = self.db.get_item(item_id)
        if not item:
            raise RuntimeError(f"Failed to retrieve created item with id {item_id}")

        return item

    def get_item(self, item_id: int) -> Dict[str, Any]:
        """
        Retrieve an item by ID.

        Args:
            item_id: The ID of the item to retrieve

        Returns:
            Dictionary containing item data

        Raises:
            ItemNotFoundError: If the item doesn't exist
        """
        item = self.db.get_item(item_id)
        if not item:
            raise ItemNotFoundError(f"Item with id {item_id} not found")

        return item

    def get_all_items(self) -> List[Dict[str, Any]]:
        """
        Retrieve all items.

        Returns:
            List of dictionaries containing item data
        """
        return self.db.get_all_items()

    def update_item(self, item_id: int, name: Optional[str] = None,
                    description: Optional[str] = None,
                    quantity: Optional[int] = None) -> Dict[str, Any]:
        """
        Update an existing item with validation.

        Args:
            item_id: The ID of the item to update
            name: New name (optional)
            description: New description (optional)
            quantity: New quantity (optional)

        Returns:
            Dictionary containing the updated item data

        Raises:
            ItemNotFoundError: If the item doesn't exist
            ItemValidationError: If validation fails
        """
        # Check if item exists
        if not self.db.get_item(item_id):
            raise ItemNotFoundError(f"Item with id {item_id} not found")

        # Validate inputs if provided
        if name is not None:
            self.validate_item_name(name)
            name = name.strip()

        if quantity is not None:
            self.validate_quantity(quantity)

        # Update item
        success = self.db.update_item(item_id, name, description, quantity)
        if not success:
            raise RuntimeError(f"Failed to update item with id {item_id}")

        # Retrieve and return the updated item
        item = self.db.get_item(item_id)
        if not item:
            raise RuntimeError(f"Failed to retrieve updated item with id {item_id}")

        return item

    def delete_item(self, item_id: int) -> None:
        """
        Delete an item.

        Args:
            item_id: The ID of the item to delete

        Raises:
            ItemNotFoundError: If the item doesn't exist
        """
        # Check if item exists
        if not self.db.get_item(item_id):
            raise ItemNotFoundError(f"Item with id {item_id} not found")

        # Delete item
        success = self.db.delete_item(item_id)
        if not success:
            raise RuntimeError(f"Failed to delete item with id {item_id}")

    def get_low_stock_items(self, threshold: int = 10) -> List[Dict[str, Any]]:
        """
        Get items with quantity below a threshold.

        Args:
            threshold: Quantity threshold (default: 10)

        Returns:
            List of items with low stock
        """
        all_items = self.db.get_all_items()
        return [item for item in all_items if item['quantity'] < threshold]

    def increase_quantity(self, item_id: int, amount: int) -> Dict[str, Any]:
        """
        Increase the quantity of an item.

        Args:
            item_id: The ID of the item
            amount: Amount to increase by

        Returns:
            Dictionary containing the updated item data

        Raises:
            ItemNotFoundError: If the item doesn't exist
            ItemValidationError: If the amount is invalid
        """
        if amount <= 0:
            raise ItemValidationError("Amount must be positive")

        item = self.get_item(item_id)
        new_quantity = item['quantity'] + amount

        self.validate_quantity(new_quantity)

        return self.update_item(item_id, quantity=new_quantity)

    def decrease_quantity(self, item_id: int, amount: int) -> Dict[str, Any]:
        """
        Decrease the quantity of an item.

        Args:
            item_id: The ID of the item
            amount: Amount to decrease by

        Returns:
            Dictionary containing the updated item data

        Raises:
            ItemNotFoundError: If the item doesn't exist
            ItemValidationError: If the amount is invalid or results in negative quantity
        """
        if amount <= 0:
            raise ItemValidationError("Amount must be positive")

        item = self.get_item(item_id)
        new_quantity = item['quantity'] - amount

        if new_quantity < 0:
            raise ItemValidationError(
                f"Cannot decrease quantity by {amount}. Current quantity: {item['quantity']}"
            )

        return self.update_item(item_id, quantity=new_quantity)
