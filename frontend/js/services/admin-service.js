function _adminFetch(body) {
  return fetch('/api/admin-users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + (window._sbToken || '')
    },
    body: JSON.stringify(body)
  });
}

export async function checkAdminStatus() {
  var res = await _adminFetch({ action: 'status' });
  if (!res.ok) return null;
  return res.json().catch(function () {
    return null;
  });
}

export async function searchUsers(query) {
  var res = await _adminFetch({ action: 'search', query: query });
  return res.json();
}

export async function setUserPlan(userId, plan) {
  await _adminFetch({ action: 'setplan', userId: userId, plan: plan });
}
