import { gh } from '../tools/infra/gh.mjs';
const n = process.argv[2];
const issue = await gh('GET', `/repos/{repo}/issues/${n}`);
console.log('TITLE:', issue.title);
console.log('LABELS:', issue.labels.map(l=>l.name).join(','));
console.log('STATE:', issue.state);
console.log('---BODY---');
console.log(issue.body);
const comments = await gh('GET', `/repos/{repo}/issues/${n}/comments?per_page=100`);
console.log('---COMMENTS(' + comments.length + ')---');
for (const c of comments) {
  console.log('### comment by', c.user.login, c.created_at);
  console.log(c.body);
  console.log('');
}
