mod services {
    pub mod greeting;
}

fn main() {
    let username = "TESTING_USER";
    let result = services::greeting::greet_user(username);
    println!("{}", result);
}
