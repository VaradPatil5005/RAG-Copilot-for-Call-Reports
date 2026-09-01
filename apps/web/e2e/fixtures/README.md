# E2E fixture PDF

`sample-call-report.pdf` is not checked in (binary fixtures don't belong
in git history for a file this disposable). Generate it once before
running the e2e suite:

```bash
cd apps/api
python3 - <<'PY'
from pathlib import Path
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

out = Path("../web/e2e/fixtures/sample-call-report.pdf")
out.parent.mkdir(parents=True, exist_ok=True)
styles = getSampleStyleSheet()
doc = SimpleDocTemplate(str(out), pagesize=letter)
doc.build([
    Paragraph("Call Report -- E2E TestCo", styles["Heading1"]),
    Spacer(1, 12),
    Paragraph(
        "E2E TestCo raised a risk about the implementation timeline slipping "
        "and mentioned Acme Corp as a competing vendor.",
        styles["Normal"],
    ),
])
print(f"wrote {out}")
PY
```

Requires the same `reportlab` dependency already pinned in
`apps/api/requirements-dev.txt`.
