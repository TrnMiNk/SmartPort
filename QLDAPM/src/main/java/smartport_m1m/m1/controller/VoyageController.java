package smartport_m1m.m1.controller;

import java.util.Map;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.*;
import smartport_m1m.m1.dto.CreateArrivalNoticeRequest;
import smartport_m1m.m1.service.VoyageService;
import smartport_m1m.m1.service.VoyageHttpException;

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

    @ExceptionHandler(VoyageHttpException.class)
    public ResponseEntity<Map<String, Object>> handleNodeError(VoyageHttpException exception) {
        return ResponseEntity.status(exception.status()).body(exception.body());
    }
}
