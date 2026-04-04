const { greetUser } = require('./services/greeting');

const USERNAME = "TESTING_USER";
const result = greetUser(USERNAME);
console.log(result);
