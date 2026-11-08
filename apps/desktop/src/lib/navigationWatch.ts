/**
 * Tells whether the page changed since the last time it was asked. Used to close dialogs, which are not
 * part of a page, when the user moves on, including with the browser's back and forward buttons.
 */
export function createNavigationWatch(initialPage: string): (page: string) => boolean {
  let current = initialPage;
  return (page) => {
    if (page === current) return false;
    current = page;
    return true;
  };
}
