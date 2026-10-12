    (function () {
      if (API.currentUser()) { location.href = "dashboard.html"; return; }

      var form = document.getElementById("regForm");
      var formError = document.getElementById("formError");
      var name = document.getElementById("name");
      var email = document.getElementById("email");
      var pw = document.getElementById("password");
      var pw2 = document.getElementById("password2");

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
        bad = invalid("fName", name.value.trim().length < 2) || bad;
        bad = invalid("fEmail", !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) || bad;
        /* mirrors the server rule so people are told before they submit */
        var classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(function (re) {
          return re.test(pw.value);
        }).length;
        var strongEnough = pw.value.length >= 10 && classes >= 3;
        bad = invalid("fPw", !strongEnough) || bad;
        bad = invalid("fPw2", pw2.value !== pw.value || !strongEnough) || bad;
        if (bad) { (document.querySelector(".field.invalid input") || {}).focus(); return; }

        var btn = document.getElementById("submitBtn");
        btn.disabled = true;
        btn.textContent = "Creating account…";

        API.register(name.value.trim(), email.value.trim(), pw.value).then(function (res) {
          if (!res.ok) {
            formError.textContent = res.error;
            formError.classList.add("show");
            btn.disabled = false;
            btn.textContent = "Create account";
            return;
          }
          location.href = "dashboard.html";
        });
      });
    })();
