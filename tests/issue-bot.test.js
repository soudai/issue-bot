const issueBot = require('../lib/issue-bot');

describe('issueBot', () => {

    test('checkInputs: only required input is title', () => {
        const ok = issueBot.checkInputs({
            title: 'Title'
        })
        expect(ok).toBe(true);
    });

    test('checkInputs: only required input is title', () => {
        const ok = issueBot.checkInputs({
            title: ''
        })
        expect(ok).toBe(false);
    });
});