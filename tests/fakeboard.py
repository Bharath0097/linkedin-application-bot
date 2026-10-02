"""A pretend job board for end-to-end checks: public search answers from memory, login wants a code."""
from jobserver.portals.base import Job, LoginError, Portal


class FakeBoard(Portal):
    key = "fakeboard"
    name = "Fake board"
    home_url = "https://fake.example/"
    needs_account = False
    supports_requests = True
    notes = "Pretend board used by the automated checks."

    def search_url(self, query):
        return "https://fake.example/?q=" + query.q

    def search_requests(self, query, session=None):
        return [Job(portal=self.key, external_id="fb-" + query.q.lower().replace(" ", "-"), title=query.q + " (Contract)", company="Globex", location=query.location or "Edison, NJ",
                    url="https://fake.example/job/" + query.q.replace(" ", "-"), remote="Hybrid", job_type="Contract", salary="$80/hour", posted="1 day ago",
                    description="Hands-on " + query.q + " role. SAP S/4HANA, ABAP, Fiori and Power BI experience required. Long-term contract.", query=query.q)]

    def open_browser(self):
        class DummyDriver:
            def quit(self): pass
            def get(self, url): pass
            def get_cookies(self): return [{"name": "sid", "value": "1", "domain": "fake.example", "path": "/"}]
            def add_cookie(self, c): pass
        return DummyDriver()

    def search(self, driver, query):
        return self.search_requests(query)

    def login(self, driver, username, password, ask_code=None):
        if password != "pw":
            raise LoginError("Fake board rejected the password.")
        if ask_code is None:
            raise LoginError("Fake board wants a code.")
        if ask_code() != "123456":
            raise LoginError("Fake board: wrong code.")

    def is_logged_in(self, driver):
        return True
