"""
M1 验收测试: 端到端测试

测试完整的 上传→解析→编辑→导出→再解析 流程
"""

import pytest
import hashlib
import json
from pathlib import Path
from fastapi.testclient import TestClient

from app.main import app
from app.core.png_chunks import extract_idat_chunks


# Golden file 路径
FIXTURES_DIR = Path(__file__).parent / "fixtures" / "golden_files"
V3_PNG = FIXTURES_DIR / "v3_card.png"
V2_PNG = FIXTURES_DIR / "v2_card.png"
DUAL_CHUNK_PNG = FIXTURES_DIR / "dual_chunk.png"


@pytest.fixture
def client():
    """Create test client"""
    return TestClient(app)


class TestEndToEndFlow:
    """端到端测试: 上传→解析→编辑→导出→再解析"""
    
    def test_full_roundtrip_v3(self, client):
        """完整的 V3 卡片往返测试"""
        # Step 1: 解析 V3 PNG
        with open(V3_PNG, "rb") as f:
            files = {"file": ("v3_card.png", f, "image/png")}
            response = client.post("/api/cards/parse", files=files)
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        parse_result = data["data"]
        assert parse_result["source_format"] == "v3"
        original_card = parse_result["card"]
        original_name = original_card["data"]["name"]
        
        # Step 2: 修改卡片数据
        modified_card = json.loads(json.dumps(original_card))  # Deep copy
        modified_card["data"]["name"] = f"{original_name}_Modified"
        modified_card["data"]["description"] = "This card has been modified."
        
        # Step 3: 导出为 PNG
        with open(V3_PNG, "rb") as f:
            response = client.post(
                "/api/cards/inject",
                files={"file": ("v3_card.png", f, "image/png")},
                data={"card_v3_json": json.dumps(modified_card), "include_v2_compat": "true"}
            )
        
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/png"
        exported_png = response.content
        
        # Step 4: 再次解析导出的 PNG
        files = {"file": ("exported.png", exported_png, "image/png")}
        response = client.post("/api/cards/parse", files=files)
        
        assert response.status_code == 200
        reimport_data = response.json()["data"]
        reimported_card = reimport_data["card"]
        
        # Step 5: 验证数据一致性
        assert reimported_card["data"]["name"] == f"{original_name}_Modified"
        assert reimported_card["data"]["description"] == "This card has been modified."
        assert reimported_card["spec"] == "chara_card_v3"
    
    def test_full_roundtrip_v2(self, client):
        """V2 卡片导入→迁移→导出→再导入"""
        # Step 1: 解析 V2 PNG
        with open(V2_PNG, "rb") as f:
            files = {"file": ("v2_card.png", f, "image/png")}
            response = client.post("/api/cards/parse", files=files)
        
        assert response.status_code == 200
        data = response.json()
        parse_result = data["data"]
        assert parse_result["source_format"] == "v2"
        original_card = parse_result["card"]
        
        # 验证已迁移到 V3
        assert original_card["spec"] == "chara_card_v3"
        assert "group_only_greetings" in original_card["data"]
        
        # Step 2: 导出
        with open(V2_PNG, "rb") as f:
            response = client.post(
                "/api/cards/inject",
                files={"file": ("v2_card.png", f, "image/png")},
                data={"card_v3_json": json.dumps(original_card), "include_v2_compat": "true"}
            )
        
        assert response.status_code == 200
        exported_png = response.content
        
        # Step 3: 再次解析
        files = {"file": ("exported.png", exported_png, "image/png")}
        response = client.post("/api/cards/parse", files=files)
        
        assert response.status_code == 200
        reimported = response.json()["data"]["card"]
        
        # 验证关键字段保留
        assert reimported["data"]["name"] == original_card["data"]["name"]
        assert reimported["data"]["description"] == original_card["data"]["description"]


class TestIdatIntegrity:
    """IDAT 完整性测试"""
    
    def test_idat_preserved_after_inject(self, client):
        """验证注入后 IDAT 完整性"""
        # 读取原始 IDAT
        original_data = V3_PNG.read_bytes()
        original_idat = extract_idat_chunks(original_data)
        original_hash = hashlib.md5(b''.join(original_idat)).hexdigest()
        
        # 执行注入
        test_card = {
            "spec": "chara_card_v3",
            "spec_version": "3.0",
            "data": {
                "name": "Test Character",
                "description": "Test description",
                "personality": "",
                "scenario": "",
                "first_mes": "Hello!",
                "mes_example": "",
                "creator_notes": "",
                "system_prompt": "",
                "post_history_instructions": "",
                "tags": ["test"],
                "creator": "tester",
                "character_version": "1.0",
                "alternate_greetings": [],
                "group_only_greetings": [],
                "extensions": {},
                "assets": []
            }
        }
        
        with open(V3_PNG, "rb") as f:
            response = client.post(
                "/api/cards/inject",
                files={"file": ("v3_card.png", f, "image/png")},
                data={"card_v3_json": json.dumps(test_card), "include_v2_compat": "false"}
            )
        
        assert response.status_code == 200
        exported_png = response.content
        
        # 验证 IDAT 一致
        exported_idat = extract_idat_chunks(exported_png)
        exported_hash = hashlib.md5(b''.join(exported_idat)).hexdigest()
        
        assert original_hash == exported_hash, "IDAT chunks must remain identical"
    
    def test_multiple_inject_preserves_idat(self, client):
        """多次注入后 IDAT 仍然完整"""
        # 读取原始 IDAT
        original_data = V3_PNG.read_bytes()
        original_idat = extract_idat_chunks(original_data)
        original_hash = hashlib.md5(b''.join(original_idat)).hexdigest()
        
        current_png = original_data
        
        # 执行 3 次注入
        for i in range(3):
            test_card = {
                "spec": "chara_card_v3",
                "spec_version": "3.0",
                "data": {
                    "name": f"Test Character {i}",
                    "description": f"Iteration {i}",
                    "personality": "",
                    "scenario": "",
                    "first_mes": "Hello!",
                    "mes_example": "",
                    "creator_notes": "",
                    "system_prompt": "",
                    "post_history_instructions": "",
                    "tags": [],
                    "creator": "",
                    "character_version": "1.0",
                    "alternate_greetings": [],
                    "group_only_greetings": [],
                    "extensions": {},
                    "assets": []
                }
            }
            
            response = client.post(
                "/api/cards/inject",
                files={"file": ("card.png", current_png, "image/png")},
                data={"card_v3_json": json.dumps(test_card), "include_v2_compat": "true"}
            )
            
            assert response.status_code == 200
            current_png = response.content
        
        # 验证最终 IDAT 与原始一致
        final_idat = extract_idat_chunks(current_png)
        final_hash = hashlib.md5(b''.join(final_idat)).hexdigest()
        
        assert original_hash == final_hash, "IDAT must be preserved after multiple injections"


class TestDualChunkPriority:
    """双 chunk 优先级测试"""
    
    def test_ccv3_takes_priority(self, client):
        """ccv3 chunk 优先于 chara chunk"""
        with open(DUAL_CHUNK_PNG, "rb") as f:
            files = {"file": ("dual_chunk.png", f, "image/png")}
            response = client.post("/api/cards/parse", files=files)
        
        assert response.status_code == 200
        result = response.json()["data"]
        
        # 应该从 ccv3 读取，而非 chara
        assert result["source_format"] == "v3"
        # dual_chunk.png 的 ccv3 包含的名称
        assert result["card"]["spec"] == "chara_card_v3"
    
    def test_fallback_to_chara_if_no_ccv3(self, client):
        """只有 chara chunk 时正确解析"""
        with open(V2_PNG, "rb") as f:
            files = {"file": ("v2_card.png", f, "image/png")}
            response = client.post("/api/cards/parse", files=files)
        
        assert response.status_code == 200
        result = response.json()["data"]
        
        # 应该从 chara 读取并迁移
        assert result["source_format"] == "v2"
        assert result["card"]["spec"] == "chara_card_v3"  # 迁移后的格式


class TestHtmlPreservation:
    """HTML 内容保真测试"""
    
    def test_html_in_first_mes_preserved(self, client):
        """first_mes 中的 HTML 标签保留"""
        html_content = '<div class="test"><b>Bold</b> and <i>italic</i></div>'
        test_card = {
            "spec": "chara_card_v3",
            "spec_version": "3.0",
            "data": {
                "name": "HTML Test",
                "description": "Test",
                "personality": "",
                "scenario": "",
                "first_mes": html_content,
                "mes_example": "",
                "creator_notes": "",
                "system_prompt": "",
                "post_history_instructions": "",
                "tags": [],
                "creator": "",
                "character_version": "1.0",
                "alternate_greetings": [html_content],
                "group_only_greetings": [],
                "extensions": {},
                "assets": []
            }
        }
        
        # 注入
        with open(V3_PNG, "rb") as f:
            response = client.post(
                "/api/cards/inject",
                files={"file": ("card.png", f, "image/png")},
                data={"card_v3_json": json.dumps(test_card), "include_v2_compat": "false"}
            )
        
        assert response.status_code == 200
        exported = response.content
        
        # 解析
        response = client.post(
            "/api/cards/parse",
            files={"file": ("card.png", exported, "image/png")}
        )
        
        assert response.status_code == 200
        reimported = response.json()["data"]["card"]
        
        # HTML 必须完整保留
        assert reimported["data"]["first_mes"] == html_content
        assert reimported["data"]["alternate_greetings"][0] == html_content


class TestUnknownFieldsPassthrough:
    """未知字段透传测试"""
    
    def test_unknown_fields_preserved(self, client):
        """未知字段在往返后保留"""
        test_card = {
            "spec": "chara_card_v3",
            "spec_version": "3.0",
            "custom_root_field": "should_preserve",
            "data": {
                "name": "Unknown Fields Test",
                "description": "Test",
                "personality": "",
                "scenario": "",
                "first_mes": "Hello",
                "mes_example": "",
                "creator_notes": "",
                "system_prompt": "",
                "post_history_instructions": "",
                "tags": [],
                "creator": "",
                "character_version": "1.0",
                "alternate_greetings": [],
                "group_only_greetings": [],
                "extensions": {"custom_ext": {"key": "value"}},
                "assets": [],
                "unknown_data_field": "also_preserve"
            }
        }
        
        # 注入
        with open(V3_PNG, "rb") as f:
            response = client.post(
                "/api/cards/inject",
                files={"file": ("card.png", f, "image/png")},
                data={"card_v3_json": json.dumps(test_card), "include_v2_compat": "false"}
            )
        
        assert response.status_code == 200
        exported = response.content
        
        # 解析
        response = client.post(
            "/api/cards/parse",
            files={"file": ("card.png", exported, "image/png")}
        )
        
        assert response.status_code == 200
        reimported = response.json()["data"]["card"]
        
        # 未知字段必须保留
        assert reimported.get("custom_root_field") == "should_preserve"
        assert reimported["data"].get("unknown_data_field") == "also_preserve"
        assert reimported["data"]["extensions"]["custom_ext"]["key"] == "value"
