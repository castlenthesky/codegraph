from .services.greeting import greet_user

if __name__ == "__main__":
    USERNAME = "TESTING_USER"
    result = greet_user(USERNAME)
    print(result)
