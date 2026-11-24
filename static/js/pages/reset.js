    (function () {
      var token = new URLSearchParams(location.search).get("token") || "";

      var form = document.getElementById("resetForm");
      var formError = document.getElementById("formError");
      var formOk = document.getElementById("formOk");
      var pw = document.getElementById("password");
      var pw2 = document.getElementById("password2");
      var btn = document.getElementById("submitBtn");

      /* A link with no token in it is not a failed password check, and saying
         "enter your password" would leave the person typing into a form that
         can never succeed. Say what actually happened. */
      if (!token) {
        form.hidden = true;
        formError.textContent = "This link is missing its code - email apps " +
          "sometimes cut long addresses in half. Request a new one and open it " +
          "straight from your inbox.";
        formError.classList.add("show");
        return;
      }

      pw.focus();

      document.getElementById("pwToggle").addEventListener("click", function () {
        var show = pw.type === "password";
        pw.type = show ? "text" : "password";
        this.setAttribute("aria-label", show ? "Hide password" : "Show password");
        this.innerHTML = '<i class="bi ' + (show ? "bi-eye-slash" : "bi-eye") + '" aria-hidden="true"></i>';
      });

      function invalid(id, bad) {
        document.getElementById(id).classList.toggle("invalid", bad);
        return bad;
      }

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        formError.classList.remove("show");

        var bad = false;
        /* same floor the server enforces, so nobody learns it the hard way */
        bad = invalid("fPw", pw.value.length < 8) || bad;
        bad = invalid("fPw2", pw2.value !== pw.value || pw.value.length < 8) || bad;
        if (bad) { (document.querySelector(".field.invalid input") || {}).focus(); return; }

        btn.disabled = true;
        btn.textContent = "Saving…";

        API.resetPassword(token, pw.value).then(function (res) {
          if (!res.ok) {
            btn.disabled = false;
            btn.textContent = "Save new password";
            formError.textContent = res.error;
            formError.classList.add("show");
            return;
          }
          /* The reset bumped this account's token version, so any session this
             browser was holding is already dead. Drop the leftovers instead of
             leaving a token that will 401 on the next request. */
          API.logout();
          form.hidden = true;
          formOk.classList.add("show");
          formOk.scrollIntoView({ block: "center" });
        });
      });
    })();
