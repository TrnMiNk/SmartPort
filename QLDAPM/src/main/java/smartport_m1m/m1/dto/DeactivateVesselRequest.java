
package smartport_m1m.m1.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record DeactivateVesselRequest(

    @NotBlank(message = "Phai nhap ly do ngung su dung")
    @Size(max = 500)
    String reason

) {}
