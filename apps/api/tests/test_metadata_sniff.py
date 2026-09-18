"""Tests for metadata sniffing (customer, owner, date detection)."""
from app.services.metadata_sniff import sniff_metadata, _clean_owner_name, _clean_customer_name


def test_clean_owner_name():
    assert _clean_owner_name("Rohit Mehra — Financial Services Account Director") == "Rohit Mehra"
    assert _clean_owner_name("Dr. Anika Sharma \ufffd Clinical Research Associate") == "Dr. Anika Sharma"
    assert _clean_owner_name("Meera Kulkarni - Supplier Quality Manager") == "Meera Kulkarni"
    assert _clean_owner_name("Dev Malhotra") == "Dev Malhotra"


def test_clean_customer_name():
    assert _clean_customer_name("Dr. R. Iyer (Principal Investigator); Priya Das") == "Dr. R. Iyer"
    assert _clean_customer_name("Northstar Bank") == "Northstar Bank"


def test_sniff_from_table_rows():
    elements = [
        {
            "element_type": "table",
            "page_number": 1,
            "text": "Report Metadata",
            "table_json": {
                "headers": ["Field", "Value"],
                "rows": [
                    ["Report ID", "CRD-FIN-002-2026"],
                    ["Domain", "Financial Services"],
                    ["Meeting date", "2026-08-05"],
                    ["Report owner", "Rohit Mehra — Financial Services Account Director"],
                    ["Customer / stakeholders", "Maya Rao (Chief Risk Officer); Suresh Nair"],
                ],
            },
        },
        {
            "element_type": "heading",
            "page_number": 1,
            "text": "Northstar Bank — Enterprise fraud-platform discovery call",
        },
    ]

    res = sniff_metadata(elements)
    assert res.get("meeting_date") == "2026-08-05"
    assert res.get("account_owner") == "Rohit Mehra"
    # Organization heading takes precedence or matches
    assert res.get("customer_name") in ["Northstar Bank", "Maya Rao"]


def test_sniff_recommended_metadata_block():
    elements = [
        {
            "element_type": "paragraph",
            "page_number": 2,
            "text": "Recommended metadata: organization=GreenGrid Distribution | owner=Arjun Reddy — Utility Lead | meeting_date=2026-08-08",
        }
    ]

    res = sniff_metadata(elements)
    assert res.get("customer_name") == "GreenGrid Distribution"
    assert res.get("account_owner") == "Arjun Reddy"
    assert res.get("meeting_date") == "2026-08-08"
