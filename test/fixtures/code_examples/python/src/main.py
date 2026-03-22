"""
Main entry point for the test application.
Demonstrates the full stack: Database -> Service -> API layers.
"""

import sys
import os

# Add the src directory to the Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from database.db import Database
from services.item_service import ItemService
from api.routes import ItemAPI


def print_response(endpoint: str, response) -> None:
    """
    Print a formatted API response.

    Args:
        endpoint: The endpoint that was called
        response: The APIResponse object
    """
    print(f"\n{'='*60}")
    print(f"Endpoint: {endpoint}")
    print(f"Status Code: {response.status_code}")
    print(f"Response: {response.to_dict()}")
    print(f"{'='*60}")


def main() -> None:
    """Main application entry point."""
    print("Starting Item Management System Demo")
    print("="*60)

    # Initialize database
    print("\n[1] Initializing database...")
    db = Database(":memory:")
    db.connect()
    db.initialize_schema()
    print("Database initialized successfully")

    # Initialize service layer
    print("\n[2] Initializing service layer...")
    item_service = ItemService(db)
    print("Service layer initialized successfully")

    # Initialize API layer
    print("\n[3] Initializing API layer...")
    api = ItemAPI(item_service)
    print("API layer initialized successfully")

    # Demo: Create items
    print("\n" + "="*60)
    print("DEMO: Creating Items")
    print("="*60)

    response = api.create_item({
        "name": "Laptop",
        "description": "High-performance laptop for development",
        "quantity": 5
    })
    print_response("POST /items", response)

    response = api.create_item({
        "name": "Mouse",
        "description": "Wireless mouse",
        "quantity": 15
    })
    print_response("POST /items", response)

    response = api.create_item({
        "name": "Keyboard",
        "description": "Mechanical keyboard",
        "quantity": 8
    })
    print_response("POST /items", response)

    # Demo: Get all items
    print("\n" + "="*60)
    print("DEMO: Retrieving All Items")
    print("="*60)

    response = api.get_items()
    print_response("GET /items", response)

    # Demo: Get single item
    print("\n" + "="*60)
    print("DEMO: Retrieving Single Item")
    print("="*60)

    response = api.get_item(1)
    print_response("GET /items/1", response)

    # Demo: Update item
    print("\n" + "="*60)
    print("DEMO: Updating Item")
    print("="*60)

    response = api.update_item(1, {
        "quantity": 3,
        "description": "High-performance laptop for development (Updated)"
    })
    print_response("PUT /items/1", response)

    # Demo: Increase quantity
    print("\n" + "="*60)
    print("DEMO: Increasing Item Quantity")
    print("="*60)

    response = api.increase_item_quantity(2, {"amount": 10})
    print_response("POST /items/2/increase", response)

    # Demo: Decrease quantity
    print("\n" + "="*60)
    print("DEMO: Decreasing Item Quantity")
    print("="*60)

    response = api.decrease_item_quantity(3, {"amount": 3})
    print_response("POST /items/3/decrease", response)

    # Demo: Get low stock items
    print("\n" + "="*60)
    print("DEMO: Getting Low Stock Items (threshold: 10)")
    print("="*60)

    response = api.get_low_stock_items(threshold=10)
    print_response("GET /items/low-stock?threshold=10", response)

    # Demo: Delete item
    print("\n" + "="*60)
    print("DEMO: Deleting Item")
    print("="*60)

    response = api.delete_item(3)
    print_response("DELETE /items/3", response)

    # Demo: Get all items after deletion
    print("\n" + "="*60)
    print("DEMO: Retrieving All Items After Deletion")
    print("="*60)

    response = api.get_items()
    print_response("GET /items", response)

    # Demo: Error handling - Get non-existent item
    print("\n" + "="*60)
    print("DEMO: Error Handling - Non-existent Item")
    print("="*60)

    response = api.get_item(999)
    print_response("GET /items/999", response)

    # Demo: Error handling - Invalid validation
    print("\n" + "="*60)
    print("DEMO: Error Handling - Validation Error")
    print("="*60)

    response = api.create_item({
        "name": "",
        "quantity": 5
    })
    print_response("POST /items (invalid name)", response)

    # Cleanup
    print("\n" + "="*60)
    print("Cleaning up...")
    db.disconnect()
    print("Database connection closed")
    print("\nDemo completed successfully!")
    print("="*60)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\nError: {e}", file=sys.stderr)
        sys.exit(1)
