package com.demo;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;

@Controller
@RequestMapping("/dept")
public class DeptController {

    /** 부서 관리 */
    @GetMapping("/list")
    public String list() {
        // 주석 안의 @GetMapping("/comment/only") 는 잡히면 안 된다
        return "dept/list";
    }

    /** 부서 삭제 화면 */
    @GetMapping("/deleteReady")
    public String deleteReady() {
        return "dept/deleteReady";
    }
}
