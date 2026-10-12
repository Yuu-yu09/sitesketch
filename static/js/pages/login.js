    (function () {
      var params = new URLSearchParams(location.search);
      var next = params.get("next") || "dashboard.html";
      if (API.currentUser()) { location.href = next; return; }

      var form = document.getElementById("loginForm");
      var formError = document.getElementById("formError");
      var email = document.getElementById("email");
      var pw = document.getElementById("password");
      var rememberMe = document.getElementById("rememberMe");

      /* Come back to a half-filled form only for the email. Saving the
         password would put it somewhere any script on the page can read. */
      var lastEmail = API.rememberedEmail();
      if (lastEmail) {
        email.value = lastEmail;
        pw.focus();
      } else {
        email.focus();
      }

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
        bad = invalid("fEmail", !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) || bad;
        bad = invalid("fPw", pw.value.length < 1) || bad;
        if (bad) { (document.querySelector(".field.invalid input") || {}).focus(); return; }

        var btn = document.getElementById("submitBtn");
        btn.disabled = true;
        btn.textContent = "Signing in…";

        API.login(email.value.trim(), pw.value, rememberMe.checked).then(function (res) {
          if (!res.ok) {
            formError.textContent = res.error;
            formError.classList.add("show");
            btn.disabled = false;
            btn.textContent = "Sign in";
            return;
          }
          location.href = next;
        });
      });
    })();
