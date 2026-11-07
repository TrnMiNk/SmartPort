package smartport_m1m.m1.controller;

import java.util.Map;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import smartport_m1m.m1.dto.CreateArrivalNoticeRequest;
import smartport_m1m.m1.service.VoyageService;

@RestController
@RequestMapping("/api/v1/voyages")
public class VoyageController {
    private final VoyageService voyageService;

    public VoyageController(VoyageService voyageService) { this.voyageService = voyageService; }

    @PostMapping
    public ResponseEntity<Map<String, Object>> create(
            @Valid @RequestBody CreateArrivalNoticeRequest request,
            @RequestHeader(name = "Idempotency-Key", required = false) String key) {
        Map<String, Object> result = voyageService.create(request, key);
        return ResponseEntity.status(Boolean.TRUE.equals(result.get("replayed"))
                ? HttpStatus.OK : HttpStatus.CREATED).body(result);
    }

    @GetMapping("/{id}")
    public ResponseEntity<Map<String, Object>> get(@PathVariable long id) {
        return ResponseEntity.ok(voyageService.get(id));
    }

    @PostMapping("/{id}/validate")
    public ResponseEntity<Map<String, Object>> validate(@PathVariable long id,
            @RequestHeader(name = "X-UC015-Key", required = false) String operatorKey, HttpServletRequest request) {
        requireLocal(request);
        return ResponseEntity.ok(voyageService.validate(id, operatorKey));
    }

    @GetMapping("/queue")
    public ResponseEntity<Map<String, Object>> queue(
            @RequestHeader(name = "X-UC015-Key", required = false) String operatorKey, HttpServletRequest request) {
        requireLocal(request);
        return ResponseEntity.ok(voyageService.queue(operatorKey));
    }

    private void requireLocal(HttpServletRequest request) {
        if (!java.util.Set.of("127.0.0.1", "::1", "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1").contains(request.getRemoteAddr()))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "UC015 is a local demo workflow");
    }
}
