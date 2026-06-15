// Entry point: wire routes + auth guard, then start the hash router.

import { route, setNotFound, start, navigate, current } from './router.js';
import { session } from './api.js';
import { renderLogin } from './views/login.js';
import { renderOrgs } from './views/orgs.js';
import { renderOrgDetail } from './views/orgDetail.js';
import { renderAdmins } from './views/admins.js';
import { renderAudit } from './views/audit.js';

/** Wrap a view so it bounces to login when there is no session. */
function guarded(fn) {
  return (params) => {
    if (!session.isLoggedIn) {
      navigate('#/login');
      return;
    }
    fn(params);
  };
}

route('/login', () => {
  if (session.isLoggedIn) { navigate('#/orgs'); return; }
  renderLogin();
});
route('/orgs', guarded(renderOrgs));
route('/orgs/:id', guarded(renderOrgDetail));
route('/admins', guarded(renderAdmins));
route('/audit', guarded(renderAudit));

setNotFound(() => {
  navigate(session.isLoggedIn ? '#/orgs' : '#/login');
});

// Default landing.
if (!current() || current() === '/') {
  navigate(session.isLoggedIn ? '#/orgs' : '#/login');
}

start();
