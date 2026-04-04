package test.fixtures.code_examples.java;

import test.fixtures.code_examples.java.services.Greeting;

public class HelloWorld {
    public static void main(String[] args) {
        String username = "TESTING_USER";
        String result = Greeting.greetUser(username);
        System.out.println(result);
    }
}
