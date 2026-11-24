    (function () {
      if (API.currentUser()) { location.href = "dashboard.html"; return; }

      var form = document.getElementById("forgotForm");
      var formError = document.getElementById("formError");
      var formOk = document.getElementById("formOk");
      var email = document.getElementById("email");
      var btn = document.getElementById("submitBtn");

      var last = API.rememberedEmail();
      if (last) email.value = last;
      email.focus();

      function invalid(id, bad) {
        document.getElementById(id).classList.toggle("invalid", bad);
        return bad;
      }

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        formError.classList.remove("show");
        formOk.classList.remove("show");

        if (invalid("fEmail", !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()))) {
          (document.querySelector(".field.invalid input") || {}).focus();
          return;
        }

        btn.disabled = true;
        btn.textContent = "Sending…";

        API.forgotPassword(email.value.trim()).then(function (res) {
          btn.disabled = false;
          btn.textContent = "Email me a link";
          if (!res.ok) {
            formError.textContent = res.error;
            formError.classList.add("show");
            return;
          }
          /* The form goes away on purpose: the next thing this person should
             do is open their inbox, not press the button again and spend one
             of three requests an hour on a link they already have. */
          form.hidden = true;
          formOk.textContent = res.message;
          formOk.classList.add("show");
        });
      });
    })();
