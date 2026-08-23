const menus = [
  { toggle: document.getElementById('account-toggle-topbar'), popover: document.getElementById('account-popover-topbar') },
  { toggle: document.getElementById('account-toggle-sidebar'), popover: document.getElementById('account-popover-sidebar') },
];

function closeAll() {
  menus.forEach(({ popover }) => popover.classList.add('hidden'));
}

menus.forEach(({ toggle, popover }) => {
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = !popover.classList.contains('hidden');
    closeAll();
    if (!wasOpen) popover.classList.remove('hidden');
  });
  popover.addEventListener('click', (e) => e.stopPropagation());
});

document.addEventListener('click', closeAll);
