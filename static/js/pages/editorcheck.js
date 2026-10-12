    var PLAN = {
      id: "check",
      meta: { type: "portfolio", goal: "showcase-work", theme: "modern", siteName: "Field Notes" },
      pages: [{
        id: "home", name: "Home",
        sections: [
          { id: "s_hero", type: "hero", title: "Landscape photography", subtitle: "Long exposures", fields: { buttonText: "See the work" } },
          {
            id: "s_wall", type: "images", title: "Selected work", subtitle: "Shape and frame each one",
            items: [
              { img: "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=1200&q=70", size: "w", text: "Plain" },
              { img: "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=1200&q=70", size: "s", text: "" },
              { img: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?w=1200&q=70", size: "t", text: "Tall" }
            ]
          }
        ]
      }]
    };

    var canvas = document.getElementById("canvas");
    Editor.mount({
      root: canvas,
      plan: PLAN,
      pageId: "home",
      onChange: function () {},
      onOpenSettings: function (id) { window.openBlock(id); },
      onOpenPhoto: function (sectionId, index) { window.openPhoto(index); }
    });

    window.openBlock = function (id) {
      EditorUI.blockPanel(document.getElementById("panelBody"));
    };

    // expose for the checks
    window.PLAN = PLAN;
    window.openPhoto = function (i) {
      Editor.openPhotoSettings("s_wall", i);
    };
