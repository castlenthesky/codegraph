"""
Database layer for the test application.
Provides SQLite operations for managing items.
"""

import sqlite3
from typing import List, Optional, Dict, Any


class Database:
    """SQLite database manager for items."""

    def __init__(self, db_path: str = ":memory:"):
        """
        Initialize the database connection.

        Args:
            db_path: Path to the SQLite database file. Defaults to in-memory database.
        """
        self.db_path = db_path
        self.conn: Optional[sqlite3.Connection] = None

    def connect(self) -> None:
        """Establish database connection."""
        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row

    def disconnect(self) -> None:
        """Close database connection."""
        if self.conn:
            self.conn.close()
            self.conn = None

    def initialize_schema(self) -> None:
        """Create the items table if it doesn't exist."""
        if not self.conn:
            raise RuntimeError("Database not connected")

        cursor = self.conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                quantity INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        self.conn.commit()

    def insert_item(self, name: str, description: Optional[str] = None,
                    quantity: int = 0) -> int:
        """
        Insert a new item into the database.

        Args:
            name: Name of the item
            description: Optional description of the item
            quantity: Quantity of the item (default: 0)

        Returns:
            The ID of the newly inserted item
        """
        if not self.conn:
            raise RuntimeError("Database not connected")

        cursor = self.conn.cursor()
        cursor.execute(
            "INSERT INTO items (name, description, quantity) VALUES (?, ?, ?)",
            (name, description, quantity)
        )
        self.conn.commit()
        return cursor.lastrowid

    def get_item(self, item_id: int) -> Optional[Dict[str, Any]]:
        """
        Retrieve an item by its ID.

        Args:
            item_id: The ID of the item to retrieve

        Returns:
            Dictionary containing item data, or None if not found
        """
        if not self.conn:
            raise RuntimeError("Database not connected")

        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM items WHERE id = ?", (item_id,))
        row = cursor.fetchone()

        if row:
            return dict(row)
        return None

    def get_all_items(self) -> List[Dict[str, Any]]:
        """
        Retrieve all items from the database.

        Returns:
            List of dictionaries containing item data
        """
        if not self.conn:
            raise RuntimeError("Database not connected")

        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM items ORDER BY created_at DESC")
        rows = cursor.fetchall()

        return [dict(row) for row in rows]

    def update_item(self, item_id: int, name: Optional[str] = None,
                    description: Optional[str] = None,
                    quantity: Optional[int] = None) -> bool:
        """
        Update an existing item.

        Args:
            item_id: The ID of the item to update
            name: New name (optional)
            description: New description (optional)
            quantity: New quantity (optional)

        Returns:
            True if the item was updated, False otherwise
        """
        if not self.conn:
            raise RuntimeError("Database not connected")

        updates = []
        params = []

        if name is not None:
            updates.append("name = ?")
            params.append(name)
        if description is not None:
            updates.append("description = ?")
            params.append(description)
        if quantity is not None:
            updates.append("quantity = ?")
            params.append(quantity)

        if not updates:
            return False

        params.append(item_id)
        query = f"UPDATE items SET {', '.join(updates)} WHERE id = ?"

        cursor = self.conn.cursor()
        cursor.execute(query, params)
        self.conn.commit()

        return cursor.rowcount > 0

    def delete_item(self, item_id: int) -> bool:
        """
        Delete an item from the database.

        Args:
            item_id: The ID of the item to delete

        Returns:
            True if the item was deleted, False otherwise
        """
        if not self.conn:
            raise RuntimeError("Database not connected")

        cursor = self.conn.cursor()
        cursor.execute("DELETE FROM items WHERE id = ?", (item_id,))
        self.conn.commit()

        return cursor.rowcount > 0

    def clear_all_items(self) -> int:
        """
        Delete all items from the database.

        Returns:
            Number of items deleted
        """
        if not self.conn:
            raise RuntimeError("Database not connected")

        cursor = self.conn.cursor()
        cursor.execute("DELETE FROM items")
        self.conn.commit()

        return cursor.rowcount
