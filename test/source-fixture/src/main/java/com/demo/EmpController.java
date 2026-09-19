package com.demo;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.*;

/**
 * <pre>
 * com.demo.EmpController
 * </pre>
 * 이 클래스 주석은 메뉴 이름이 되면 안 된다 (바로 위 주석만 이름이 된다)
 */
@Controller
@RequestMapping("/emp")
public class EmpController {

    /** 사원 목록 */
    @GetMapping(value = {"", "index"})
    public String list(Model model) {
        return "emp/list";
    }

    // 사원 등록 화면
    @GetMapping("/form")
    public String form(Model model) {
        return "emp/form";
    }

    /** 사원 저장 — POST 라 메뉴가 아니다 */
    @PostMapping("/save")
    public String save(EmpVo vo) {
        return "redirect:/emp";
    }

    /** 사원 목록 그리드 데이터 — API 라 메뉴가 아니다 */
    @GetMapping("/selectList")
    @ResponseBody
    public Map<String, Object> selectList(@RequestParam Map<String, Object> p) {
        return service.list(p);
    }

    /** 사원 선택 팝업 — 모달이라 메뉴가 아니다 */
    @GetMapping("/empPickModal")
    public String empPickModal() {
        return "emp/modal";
    }

    /** 사원 상세 — 경로 변수라 직접 못 연다 */
    @GetMapping("/{empNo}")
    public String detail(@PathVariable String empNo) {
        return "emp/detail";
    }

    /** 엑셀 다운로드 — 화면이 아니다 */
    @GetMapping("/excel")
    public void excel() {
    }
}
